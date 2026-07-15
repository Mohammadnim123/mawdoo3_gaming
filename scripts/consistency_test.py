#!/usr/bin/env python3
"""Consistency test — generate two different games and verify the generation
service produces stable, uniform output.

Two prompts in two languages and genres go through the full pipeline; the
resulting bundles are then compared structurally:

  1. both generations succeed end-to-end
  2. both bundles contain exactly the same file set (the five-file contract)
  3. the pinned runtime (engine.js / engine.css) is byte-identical
  4. both games are on the same template version with the same manifest shape
  5. the index.html skeleton is identical once per-game values are normalized
  6. the gameplay code (game.js) is genuinely bespoke per game — not shared —
     while still following the same contract (window.createGame + sdk.ready)

Run with both the generation service and its dependencies up:
    python3 scripts/consistency_test.py            # or: make consistency
Reuse existing games (skip generation, compare only):
    python3 scripts/consistency_test.py --games <id1> <id2>

Stdlib only. Exit code 0 = consistent, 1 = inconsistent/failed.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
_DEFAULT_STORAGE = REPO_ROOT / "services" / "generation-service" / "var" / "storage"

# Same env vars the services read, so the script follows a re-configured
# deployment instead of silently checking the wrong port/folder.
API = os.environ.get("GENERATION_API_URL", "http://localhost:8000").rstrip("/")
STORAGE_DIR = Path(os.environ.get("GAMES_STORAGE_DIR", str(_DEFAULT_STORAGE)))
PROMPTS = [
    "Build a Snake game",
    "لعبة تخمين أرقام",
]
EXPECTED_FILES = {"index.html", "engine.js", "engine.css", "game.js", "game.css"}
POLL_SECONDS = 5
TIMEOUT_SECONDS = 600

_results: list[tuple[bool, str]] = []


def check(passed: bool, label: str, detail: str = "") -> None:
    _results.append((passed, label))
    mark = "PASS" if passed else "FAIL"
    print(f"  [{mark}] {label}" + (f" — {detail}" if detail else ""))


def api(method: str, path: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        f"{API}{path}", data=data, method=method,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def generate(prompt: str) -> str:
    """Start a generation and poll to completion; returns the game id."""
    job = api("POST", "/api/v1/generations", {"prompt": prompt})
    print(f"  job {job['id']} started for prompt: {prompt}")
    deadline = time.time() + TIMEOUT_SECONDS
    while time.time() < deadline:
        current = api("GET", f"/api/v1/generations/{job['id']}")
        if current["status"] == "succeeded":
            print(f"  job {job['id']} succeeded → game {current['game_id']}")
            return current["game_id"]
        if current["status"] == "failed":
            error = current.get("error") or {}
            raise RuntimeError(f"job {job['id']} failed: {error.get('message')}")
        time.sleep(POLL_SECONDS)
    raise RuntimeError(f"job {job['id']} timed out after {TIMEOUT_SECONDS}s")


def read_bundle(game_id: str) -> dict[str, bytes]:
    bundle_dir = STORAGE_DIR / "games" / game_id
    return {p.name: p.read_bytes() for p in bundle_dir.iterdir() if p.is_file()}


def manifest_of(bundle: dict[str, bytes]) -> dict:
    html = bundle["index.html"].decode()
    match = re.search(
        r'<script type="application/json" id="game-manifest">(.*?)</script>', html, re.S
    )
    if not match:
        raise RuntimeError("no game-manifest in index.html")
    return json.loads(match.group(1))


def normalized_index(bundle: dict[str, bytes]) -> str:
    """index.html with the per-game values blanked — what remains is the
    template skeleton, which must be identical across games."""
    html = bundle["index.html"].decode()
    html = re.sub(r'lang="[^"]*"', 'lang="_"', html)
    html = re.sub(r'dir="[^"]*"', 'dir="_"', html)
    html = re.sub(r"<title>.*?</title>", "<title>_</title>", html, flags=re.S)
    html = re.sub(
        r'(<script type="application/json" id="game-manifest">).*?(</script>)',
        r"\1_\2",
        html,
        flags=re.S,
    )
    return html


def compare(game_ids: list[str]) -> None:
    games = [api("GET", f"/api/v1/games/{gid}") for gid in game_ids]
    bundles = [read_bundle(gid) for gid in game_ids]
    a, b = bundles

    print("\n== Structural comparison ==")
    check(
        set(a) == set(b) == EXPECTED_FILES,
        "identical file sets (the five-file contract)",
        f"{sorted(a)} vs {sorted(b)}",
    )
    check(
        a["engine.js"] == b["engine.js"] and a["engine.css"] == b["engine.css"],
        "pinned runtime byte-identical (engine.js, engine.css)",
    )
    check(
        games[0]["template_version"] == games[1]["template_version"],
        "same template version",
        games[0]["template_version"],
    )

    manifests = [manifest_of(x) for x in bundles]
    check(
        set(manifests[0]) == set(manifests[1]),
        "same manifest shape",
        ", ".join(sorted(manifests[0])),
    )
    check(
        manifests[0]["contract"] == manifests[1]["contract"],
        "same game contract",
        manifests[0]["contract"],
    )
    check(
        normalized_index(a) == normalized_index(b),
        "index.html skeleton identical after normalizing per-game values",
    )
    check(
        a["game.js"] != b["game.js"],
        "gameplay code is bespoke per game (game.js differs)",
    )
    for gid, bundle in zip(game_ids, bundles):
        game_js = bundle["game.js"].decode()
        check(
            "window.createGame" in game_js and "sdk.ready" in game_js,
            f"game {gid} follows the createGame contract",
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--games", nargs=2, metavar="ID", help="compare two existing games")
    args = parser.parse_args()

    try:
        api("GET", "/health")
    except (urllib.error.URLError, OSError):
        print(f"generation service is not reachable at {API} — start it first (make dev-service)")
        return 1

    if args.games:
        game_ids = args.games
    else:
        print("== Generating two different games ==")
        try:
            game_ids = [generate(prompt) for prompt in PROMPTS]
        except RuntimeError as exc:
            print(f"  [FAIL] {exc}")
            return 1

    compare(game_ids)

    failed = [label for passed, label in _results if not passed]
    print(
        f"\n== {'CONSISTENT' if not failed else 'INCONSISTENT'} — "
        f"{len(_results) - len(failed)}/{len(_results)} checks passed =="
    )
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
