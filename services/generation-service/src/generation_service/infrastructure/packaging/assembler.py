"""Light assembly: bespoke game files + the pinned starter template = one
self-contained static bundle.

No per-game install, no third-party dependencies, no leftover files — the
bundle contains exactly what it needs to run (index.html, engine.js,
engine.css, game.js, game.css) and nothing else. The only dependency of a
generated game is the pinned template version, which makes builds trivially
reproducible.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from generation_service.domain.blueprint import GameBlueprint
from generation_service.domain.entities import GeneratedGameCode

# The bundle contract: every generated game ships exactly these files
# (+ three.min.js when the blueprint is webgl3d, + bg.png when the pipeline
# painted a backdrop). Tests import these constants instead of maintaining
# their own copies.
BUNDLE_FILES = frozenset({"index.html", "engine.js", "engine.css", "game.js", "game.css"})
OPTIONAL_RUNTIME_FILE = "three.min.js"
OPTIONAL_ART_FILE = "bg.png"
SPRITE_FILE_PREFIX = "sprite_"


def sprite_file_name(name: str) -> str:
    """Bundle filename for a blueprint sprite brief (sanitized, collision-safe)."""
    safe = "".join(c for c in name if c.isalnum() or c in "-_") or "sprite"
    return f"{SPRITE_FILE_PREFIX}{safe}.png"

_TOKEN_PATTERN = re.compile(r"__(LANG|DIR|TEMPLATE_VERSION|TITLE|MANIFEST_JSON|EXTRA_RUNTIME)__")


@dataclass(frozen=True, slots=True)
class StarterTemplate:
    """The versioned template, loaded once at startup (fail fast if broken)."""

    version: str
    contract: str
    page_template: str
    engine_js: str
    engine_css: str
    contract_doc: str
    three_js: bytes | None  # pinned Three.js runtime for webgl3d games

    @classmethod
    def load(cls, template_dir: Path) -> StarterTemplate:
        """Load the files template.json declares — the manifest is the single
        source of truth for the template's layout."""
        meta = json.loads((template_dir / "template.json").read_text(encoding="utf-8"))
        runtime_files = {Path(rel).suffix: rel for rel in meta["files"]["runtime"]}
        optional = [
            template_dir / rel
            for rel in meta["files"].get("optional_runtime", [])
            if (template_dir / rel).is_file()
        ]
        return cls(
            version=meta["version"],
            contract=meta["contract"],
            page_template=(template_dir / meta["files"]["page"]).read_text(encoding="utf-8"),
            engine_js=(template_dir / runtime_files[".js"]).read_text(encoding="utf-8"),
            engine_css=(template_dir / runtime_files[".css"]).read_text(encoding="utf-8"),
            contract_doc=(template_dir / "CONTRACT.md").read_text(encoding="utf-8"),
            three_js=optional[0].read_bytes() if optional else None,
        )


class TemplateAssembler:
    def __init__(self, template: StarterTemplate) -> None:
        self._template = template

    @property
    def template_version(self) -> str:
        return self._template.version

    @property
    def contract_doc(self) -> str:
        return self._template.contract_doc

    def assemble(
        self,
        game_id: str,
        blueprint: GameBlueprint,
        code: GeneratedGameCode,
        background_art: bytes | None = None,
        sprites: dict[str, bytes] | None = None,
    ) -> dict[str, bytes]:
        """Return the complete bundle as {relative_path: content}."""
        locale = blueprint.default_locale
        wants_3d = blueprint.rendering == "webgl3d"
        if wants_3d and self._template.three_js is None:
            raise RuntimeError("blueprint requires webgl3d but the template has no three.min.js")
        values = {
            "LANG": locale,
            "DIR": "rtl" if locale == "ar" else "ltr",
            "TEMPLATE_VERSION": self._template.version,
            "TITLE": _escape_html(getattr(blueprint.title, locale)),
            "MANIFEST_JSON": _escape_json_for_script(
                self._runtime_manifest(game_id, blueprint)
            ),
            "EXTRA_RUNTIME": (
                f'  <script src="{OPTIONAL_RUNTIME_FILE}"></script>\n' if wants_3d else ""
            ),
        }
        # Single-pass substitution: a token literal inside blueprint text can
        # never be re-substituted by a later replacement.
        page = _TOKEN_PATTERN.sub(lambda m: values[m.group(1)], self._template.page_template)
        bundle = {
            "index.html": page.encode(),
            "engine.js": self._template.engine_js.encode(),
            "engine.css": self._template.engine_css.encode(),
            "game.js": code.game_js.encode(),
            "game.css": code.game_css.encode(),
        }
        if wants_3d:
            bundle[OPTIONAL_RUNTIME_FILE] = self._template.three_js  # type: ignore[assignment]
        if background_art:
            bundle[OPTIONAL_ART_FILE] = background_art
        for file_name, data in (sprites or {}).items():
            bundle[file_name] = data
        return bundle

    def _runtime_manifest(self, game_id: str, blueprint: GameBlueprint) -> str:
        """Only what the runtime needs — the blueprint itself stays internal."""
        return json.dumps(
            {
                "gameId": game_id,
                "templateVersion": self._template.version,
                "contract": self._template.contract,
                "title": {"en": blueprint.title.en, "ar": blueprint.title.ar},
                "defaultLocale": blueprint.default_locale,
                "tweaks": blueprint.tweaks_table(),
                "strings": blueprint.strings_table(),
            },
            ensure_ascii=False,
        )


def _escape_html(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _escape_json_for_script(payload: str) -> str:
    """Neutralize every '<' inside the embedded JSON with its JSON escape.

    In JSON, '<' can only occur inside string values, so the global replace is
    lossless (JSON.parse restores it). This closes both '</script>' AND the
    subtler '<!--<script' double-escape sequence that a bare '</'-only escape
    would let through.
    """
    return payload.replace("<", "\\u003c")
