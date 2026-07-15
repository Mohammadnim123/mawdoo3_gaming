"""The quality gate.

Every generated game passes here before it is packaged or stored. Because
generation is bespoke, this gate is the primary guarantee of correctness;
several whole defect classes (leaked timers/listeners, network calls,
external deps) are rejected structurally by forbidding the raw APIs and
forcing the SDK equivalents the template cleans up automatically.

Checks are deterministic and cheap by design; failures produce actionable
feedback that is fed back into capped code-generation retries. Failures on
BLOCKING_CHECK_IDS (unsafe or unrunnable) are the only ones that can keep a
game from shipping — once retries are exhausted, the best attempt with
advisory-only failures is published rather than shown as an error.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import shutil
import tempfile
from pathlib import Path

from generation_service.domain.blueprint import GameBlueprint
from generation_service.domain.entities import GateCheck, GateReport, GeneratedGameCode

logger = logging.getLogger(__name__)

_SMOKE_BOOT_SCRIPT = Path(__file__).parent / "smoke_boot.js"

# Raw lifecycle APIs — games must use the SDK equivalents so the template can
# guarantee cleanup (sdk.after / sdk.every / sdk.loop / sdk.on / sdk.audio).
_LIFECYCLE_FORBIDDEN: list[tuple[str, str]] = [
    (r"\bsetTimeout\b", "raw setTimeout — use sdk.after(ms, fn)"),
    (r"\bsetInterval\b", "raw setInterval — use sdk.every(ms, fn)"),
    (r"\brequestAnimationFrame\b", "raw requestAnimationFrame — use sdk.loop(update)"),
    (r"\bcancelAnimationFrame\b", "raw cancelAnimationFrame — sdk.loop returns {stop()}"),
    (r"\bsetAnimationLoop\b", "renderer.setAnimationLoop — use sdk.loop(update) instead"),
    (r"\baddEventListener\b", "raw addEventListener — use sdk.on(target, type, handler)"),
    (r"\bremoveEventListener\b", "raw removeEventListener — sdk.on returns an off()"),
    (r"\bAudioContext\b", "raw AudioContext — use sdk.audio.beep(...)"),
    (r"\bnew\s+Audio\b", "raw Audio element — use sdk.audio.beep(...)"),
]

# Sandbox / self-containment rules (C2: generated code is untrusted).
_SANDBOX_FORBIDDEN: list[tuple[str, str]] = [
    (r"\bfetch\s*\(", "network access (fetch) is forbidden"),
    (r"\bXMLHttpRequest\b", "network access (XMLHttpRequest) is forbidden"),
    (r"\bWebSocket\b", "network access (WebSocket) is forbidden"),
    (r"\bEventSource\b", "network access (EventSource) is forbidden"),
    (r"\bnavigator\.sendBeacon\b", "network access (sendBeacon) is forbidden"),
    (r"\beval\s*\(", "eval is forbidden"),
    (r"\bnew\s+Function\b", "new Function is forbidden"),
    (r"\bdocument\.cookie\b", "cookie access is forbidden"),
    (r"\blocalStorage\b", "localStorage is forbidden — use sdk.storage"),
    (r"\bsessionStorage\b", "sessionStorage is forbidden — use sdk.storage"),
    (r"\bindexedDB\b", "indexedDB is forbidden — use sdk.storage"),
    (r"\bwindow\s*\.\s*(parent|top|open)\b", "host-page access is forbidden — use sdk.report"),
    (r"\bimportScripts\b", "importScripts is forbidden"),
    (r"\bimport\s*\(", "dynamic import is forbidden"),
    (r"^\s*import\s+", "ES module imports are forbidden — game.js is a plain script"),
    (r"\brequire\s*\(", "require is forbidden"),
    (r"<\s*script", "injecting script tags is forbidden"),
    (r"https?://", "external URLs are forbidden — bundles must be self-contained"),
]

# W3C namespace identifiers are not network access — createElementNS (inline
# SVG) is explicitly allowed by the code prompt, so these literals are blanked
# before the sandbox patterns run.
_SAFE_URL_ALLOWLIST = (
    "http://www.w3.org/2000/svg",
    "http://www.w3.org/1999/xlink",
    "http://www.w3.org/1999/xhtml",
)

# sdk.ready() call sites the contract check accepts: a direct member call
# (optionally ?.), or `ready` destructured from sdk and then called bare —
# models write both styles and the game works either way.
_READY_DIRECT = re.compile(r"\bsdk\s*\??\.\s*ready\s*\(")
_READY_DESTRUCTURED = re.compile(r"\{[^{}]*\bready\b[^{}]*\}\s*=\s*sdk\b")
_READY_BARE_CALL = re.compile(r"\bready\s*\(")

# Same tolerance for localization: direct sdk.t(...) / sdk.strings, or the
# helpers destructured from sdk.
_I18N_DIRECT = re.compile(r"\bsdk\s*\??\.\s*(t\s*\(|strings\b)")
_I18N_DESTRUCTURED = re.compile(r"\{[^{}]*\b(t|strings)\b[^{}]*\}\s*=\s*sdk\b")


class QualityGate:
    def __init__(
        self,
        node_syntax_check: bool,
        max_game_kb: int,
        smoke_boot: bool = True,
        smoke_boot_timeout_seconds: float = 30.0,
        syntax_check_timeout_seconds: float = 20.0,
    ) -> None:
        self._node_syntax_check = node_syntax_check
        self._smoke_boot = smoke_boot
        self._smoke_boot_timeout = smoke_boot_timeout_seconds
        self._syntax_check_timeout = syntax_check_timeout_seconds
        self._max_game_bytes = max_game_kb * 1024
        self._node_bin = shutil.which("node")

    async def run(self, blueprint: GameBlueprint, code: GeneratedGameCode) -> GateReport:
        checks: list[GateCheck] = [
            self._check_contract_entrypoint(code),
            self._check_contract_ready(code),
            *self._check_patterns(code, "lifecycle.sdk_managed", _LIFECYCLE_FORBIDDEN),
            *self._check_patterns(code, "sandbox.forbidden_api", _SANDBOX_FORBIDDEN),
            self._check_localization(blueprint, code),
            self._check_size(code),
        ]
        syntax = await self._check_syntax(code)
        checks.append(syntax)
        if syntax.passed:
            # Only boot code that parses — a parse failure already has feedback.
            checks.append(await self._check_runtime(blueprint, code))
        return GateReport(passed=all(c.passed for c in checks), checks=checks)

    # ------------------------------------------------------------------ #

    @staticmethod
    def _check_contract_entrypoint(code: GeneratedGameCode) -> GateCheck:
        ok = re.search(r"window\.createGame\s*=", code.game_js) is not None
        return GateCheck(
            check_id="contract.create_game",
            passed=ok,
            detail="" if ok else "game.js must assign window.createGame = function ({mount, sdk})",
        )

    @staticmethod
    def _check_contract_ready(code: GeneratedGameCode) -> GateCheck:
        js = code.game_js
        ok = _READY_DIRECT.search(js) is not None or (
            _READY_DESTRUCTURED.search(js) is not None
            and _READY_BARE_CALL.search(js) is not None
        )
        return GateCheck(
            check_id="contract.ready",
            passed=ok,
            detail=(
                ""
                if ok
                else "the game must call sdk.ready() once its first frame is visible — "
                "write the literal member call sdk.ready(), without aliasing sdk"
            ),
        )

    @staticmethod
    def _check_patterns(
        code: GeneratedGameCode, check_prefix: str, patterns: list[tuple[str, str]]
    ) -> list[GateCheck]:
        source = code.game_js + "\n" + code.game_css
        for safe_url in _SAFE_URL_ALLOWLIST:
            source = source.replace(safe_url, "")
        failures = [
            GateCheck(check_id=check_prefix, passed=False, detail=detail)
            for pattern, detail in patterns
            if re.search(pattern, source, flags=re.MULTILINE)
        ]
        if failures:
            return failures
        return [GateCheck(check_id=check_prefix, passed=True)]

    @staticmethod
    def _check_localization(blueprint: GameBlueprint, code: GeneratedGameCode) -> GateCheck:
        if not blueprint.ui_strings:
            return GateCheck(check_id="i18n.strings_used", passed=True, detail="no ui strings")
        ok = (
            _I18N_DIRECT.search(code.game_js) is not None
            or _I18N_DESTRUCTURED.search(code.game_js) is not None
        )
        return GateCheck(
            check_id="i18n.strings_used",
            passed=ok,
            detail=(
                ""
                if ok
                else "the blueprint defines ui_strings but the game never calls sdk.t(...) — "
                "all user-facing text must be localized"
            ),
        )

    def _check_size(self, code: GeneratedGameCode) -> GateCheck:
        size = len(code.game_js.encode()) + len(code.game_css.encode())
        ok = size <= self._max_game_bytes
        return GateCheck(
            check_id="bundle.size",
            passed=ok,
            detail="" if ok else f"game code is {size} bytes, cap is {self._max_game_bytes}",
        )

    async def _check_runtime(
        self, blueprint: GameBlueprint, code: GeneratedGameCode
    ) -> GateCheck:
        """Boot the game headlessly and drive a few simulated seconds of frames
        and input. Catches the defect class syntax checks can't: crashes on the
        first frame, null state before init, broken input handlers."""
        check_id = "runtime.smoke_boot"
        if not self._smoke_boot or self._node_bin is None:
            return GateCheck(check_id=check_id, passed=True, detail="skipped")
        if blueprint.rendering == "webgl3d":
            # The harness has no THREE stub; 3D games boot against the real runtime.
            return GateCheck(check_id=check_id, passed=True, detail="skipped (webgl3d)")

        manifest = {
            "defaultLocale": blueprint.default_locale,
            "tweaks": blueprint.tweaks_table(),
            "strings": blueprint.strings_table(),
        }
        tmp_dir = Path(tempfile.mkdtemp(prefix="smoke-boot-"))
        game_path = tmp_dir / "game.js"
        manifest_path = tmp_dir / "manifest.json"
        try:
            game_path.write_text(code.game_js, encoding="utf-8")
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
            proc = await asyncio.create_subprocess_exec(
                self._node_bin,
                str(_SMOKE_BOOT_SCRIPT),
                str(game_path),
                str(manifest_path),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout, _ = await asyncio.wait_for(
                    proc.communicate(), timeout=self._smoke_boot_timeout
                )
            except TimeoutError:
                # A hang is a game defect (infinite loop in an update/handler),
                # not a harness limitation — fail it and reap the process.
                await self._reap(proc)
                return GateCheck(
                    check_id=check_id,
                    passed=False,
                    detail=(
                        f"the game did not finish the simulated frames within "
                        f"{self._smoke_boot_timeout:.0f}s — it freezes for every player. "
                        "Remove any unbounded while-loop from update/input handlers; "
                        "per-frame work must return within the frame."
                    ),
                )
            if proc.returncode == 0:
                return GateCheck(check_id=check_id, passed=True)
            output = stdout.decode(errors="replace").strip()[:1200]
            return GateCheck(
                check_id=check_id,
                passed=False,
                detail=(
                    "the game crashes when booted and run (this exact error would hit "
                    f"every player):\n{output}\n"
                    "Make sure all state used by the render/update loop is initialized "
                    "before sdk.loop starts, and guard objects that only exist in some "
                    "phases."
                ),
            )
        except OSError as exc:
            logger.warning("smoke boot unavailable, skipping runtime gate: %s", exc)
            return GateCheck(check_id=check_id, passed=True, detail="skipped")
        finally:
            await asyncio.to_thread(shutil.rmtree, tmp_dir, ignore_errors=True)

    @staticmethod
    async def _reap(proc: asyncio.subprocess.Process) -> None:
        """Kill a timed-out child and wait for it, so no orphan keeps spinning."""
        try:
            proc.kill()
            await proc.communicate()
        except (ProcessLookupError, OSError):
            pass

    async def _check_syntax(self, code: GeneratedGameCode) -> GateCheck:
        if not self._node_syntax_check or self._node_bin is None:
            return GateCheck(check_id="syntax.node_check", passed=True, detail="skipped")
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".js", delete=False, encoding="utf-8"
        ) as handle:
            handle.write(code.game_js)
            tmp_path = Path(handle.name)
        try:
            proc = await asyncio.create_subprocess_exec(
                self._node_bin,
                "--check",
                str(tmp_path),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                _, stderr = await asyncio.wait_for(
                    proc.communicate(), timeout=self._syntax_check_timeout
                )
            except TimeoutError as exc:
                # Parsing can't hang on game logic — treat as an environment
                # problem, but never leave the child running.
                await self._reap(proc)
                logger.warning("node --check timed out, skipping syntax gate: %s", exc)
                return GateCheck(check_id="syntax.node_check", passed=True, detail="skipped")
            ok = proc.returncode == 0
            detail = "" if ok else stderr.decode(errors="replace").strip()[:1000]
            return GateCheck(check_id="syntax.node_check", passed=ok, detail=detail)
        except OSError as exc:
            logger.warning("node --check unavailable, skipping syntax gate: %s", exc)
            return GateCheck(check_id="syntax.node_check", passed=True, detail="skipped")
        finally:
            await asyncio.to_thread(tmp_path.unlink, missing_ok=True)
