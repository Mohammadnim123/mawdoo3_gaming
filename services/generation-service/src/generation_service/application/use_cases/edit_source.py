"""Hand-editing a game's source (PUT /api/v1/games/{id}/source).

The creator edits game.js/game.css directly; the edit goes through the SAME
static validation gate the pipeline uses (no LLM call anywhere on this path),
is re-assembled against the stored blueprint + pinned template, and lands as
a new immutable version with the current pointer flipped — exactly the
mechanics the tweak finalize path uses, minus the pipeline.

Gate findings are surfaced as Codply-style lint findings ({rule, line,
snippet}) in the 422 error envelope's details.
"""

from __future__ import annotations

import logging
import re

from generation_service.domain.entities import (
    Game,
    GameVersion,
    GateReport,
    GeneratedGameCode,
    game_version_prefix,
    new_id,
)
from generation_service.domain.errors import (
    ConflictError,
    NotFoundError,
    SourceValidationError,
)
from generation_service.domain.ports import (
    GameRepository,
    GameVersionRepository,
    JobRepository,
    StoragePort,
)
from generation_service.infrastructure.packaging.assembler import (
    OPTIONAL_ART_FILE,
    TemplateAssembler,
    sprite_file_name,
)
from generation_service.infrastructure.packaging.cover import write_cover
from generation_service.infrastructure.storage import store_bundle
from generation_service.infrastructure.validation.gate import (
    _LIFECYCLE_FORBIDDEN,
    _SAFE_URL_ALLOWLIST,
    _SANDBOX_FORBIDDEN,
    QualityGate,
)

logger = logging.getLogger(__name__)

HAND_EDIT_SUMMARY = "Hand-edited"

# Reverse map: a failing pattern check's detail text -> its regex, so findings
# can carry the real line + snippet of the offending source.
_PATTERN_BY_DETAIL: dict[str, str] = {
    detail: pattern for pattern, detail in (*_LIFECYCLE_FORBIDDEN, *_SANDBOX_FORBIDDEN)
}


def gate_findings(report: GateReport, code: GeneratedGameCode) -> list[dict]:
    """Adapt gate failures to Codply LintFinding items: {rule, line, snippet}.

    Pattern-based failures (lifecycle/sandbox) are re-located in the edited
    source for a real 1-based line + code snippet; structural failures
    (contract, syntax, size...) carry line 0 and the check's detail text.
    """
    source = code.game_js + "\n" + code.game_css
    # Blank allowlisted W3C namespace URLs with equal-length filler so match
    # offsets keep pointing into the ORIGINAL source.
    scannable = source
    for safe_url in _SAFE_URL_ALLOWLIST:
        scannable = scannable.replace(safe_url, " " * len(safe_url))

    findings: list[dict] = []
    for check in report.failures:
        line = 0
        snippet = (check.detail or check.check_id).splitlines()[0][:120]
        pattern = _PATTERN_BY_DETAIL.get(check.detail)
        if pattern:
            match = re.search(pattern, scannable, flags=re.MULTILINE)
            if match:
                line = scannable.count("\n", 0, match.start()) + 1
                line_start = source.rfind("\n", 0, match.start()) + 1
                line_end = source.find("\n", match.start())
                if line_end == -1:
                    line_end = len(source)
                snippet = source[line_start:line_end].strip()[:80]
        findings.append({"rule": check.check_id, "line": line, "snippet": snippet})
    return findings


class EditSourceUseCase:
    def __init__(
        self,
        games: GameRepository,
        versions: GameVersionRepository,
        jobs: JobRepository,
        gate: QualityGate,
        assembler: TemplateAssembler,
        storage: StoragePort,
    ) -> None:
        self._games = games
        self._versions = versions
        self._jobs = jobs
        self._gate = gate
        self._assembler = assembler
        self._storage = storage

    async def execute(
        self, game_id: str, game_js: str, game_css: str | None
    ) -> tuple[Game, GameVersion]:
        game = await self._games.get(game_id)
        if game is None:
            raise NotFoundError(f"game {game_id!r} not found")
        # A hand-edit racing a rebuild would clobber the finishing job's
        # pointer flip — same rule as rollback.
        if await self._jobs.has_active_job_for_game(game.id):
            raise ConflictError("this game is being updated — wait for the edit to finish")

        code = GeneratedGameCode(game_js=game_js, game_css=game_css or "")
        report = await self._gate.run(game.blueprint, code)
        if not report.passed:
            raise SourceValidationError(
                "the edited source failed validation",
                details={"findings": gate_findings(report, code)},
            )

        # Assemble against the stored blueprint + pinned template, carrying
        # the current version's art over unchanged (same as tweak rebuilds).
        background = await self._fetch(f"{game.storage_prefix}/{OPTIONAL_ART_FILE}")
        sprites: dict[str, bytes] = {}
        for brief in game.blueprint.sprite_briefs[:3]:
            file_name = sprite_file_name(brief.name)
            data = await self._fetch(f"{game.storage_prefix}/{file_name}")
            if data is not None:
                sprites[file_name] = data
        bundle = self._assembler.assemble(
            game.id, game.blueprint, code, background_art=background, sprites=sprites
        )

        next_no = await self._versions.max_version_no(game.id) + 1
        prefix = game_version_prefix(game.id, next_no)
        await store_bundle(self._storage, prefix, bundle)

        cover_file: str | None = None
        try:
            cover_file = await write_cover(self._storage, prefix, bundle, game.blueprint)
        except Exception:  # noqa: BLE001 — covers are cosmetic, never blocking
            logger.warning("could not write cover for hand-edit of %s", game.id)

        version = GameVersion(
            id=new_id(),
            game_id=game.id,
            version_no=next_no,
            parent_id=game.current_version_id,
            job_id=None,
            change_summary=HAND_EDIT_SUMMARY,
            storage_prefix=prefix,
            blueprint=game.blueprint,
        )
        await self._versions.add(version)
        game.storage_prefix = prefix
        game.current_version_id = version.id
        game.current_version_no = version.version_no
        game.cover_file = cover_file
        await self._games.update(game)
        logger.info("game %s hand-edited to v%d", game.id, next_no)
        return game, version

    async def _fetch(self, key: str) -> bytes | None:
        try:
            return await self._storage.get(key)
        except Exception:  # noqa: BLE001 — absent art is the normal case
            return None
