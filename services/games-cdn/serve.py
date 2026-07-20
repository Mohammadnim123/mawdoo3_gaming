#!/usr/bin/env python3
"""Games CDN stand-in — the dedicated static origin for generated games.

Serves the generation service's S3-mimicking storage folder
(var/storage → keys like games/{id}/index.html) exactly the way a
bucket + CDN would in production: dumb static files, revalidation
caching, hardened headers. The web client's sandboxed iframes load games
from this origin, so generated (untrusted) code always runs on a foreign
origin — separate from both the UI and the generation API.

Stdlib only, zero dependencies. Run:  python3 serve.py   (or: make dev-cdn)
Config: CDN_HOST (default 0.0.0.0) · CDN_PORT (default 7002, matching the
engine's default CDN_BASE_URL) ·
GAMES_STORAGE_DIR (default <repo>/services/generation-service/var/storage)
"""

from __future__ import annotations

import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DIR = REPO_ROOT / "services" / "generation-service" / "var" / "storage"

# Same defense-in-depth headers as the generation service's play route:
# the iframe sandbox is the real boundary; this hardens the origin itself.
_CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data:; connect-src 'none'"
)

# Bundles are replaced in place on tweaks: no-cache forces revalidation, and
# SimpleHTTPRequestHandler answers If-Modified-Since with cheap 304s.
_CACHE_CONTROL = "no-cache"


class GameFileHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", _CACHE_CONTROL)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", _CSP)
        # Bundles are public content behind unguessable URLs; the web app's
        # Code view fetches text files cross-origin for read-only display.
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def list_directory(self, path):  # noqa: ANN001 — stdlib signature
        # Never enumerate the storage tree: a directory index would leak every
        # game id, defeating unguessable play URLs.
        self.send_error(404, "Not Found")
        return None

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("games-cdn: %s\n" % (fmt % args))


def main() -> None:
    host = os.environ.get("CDN_HOST", "0.0.0.0")
    port = int(os.environ.get("CDN_PORT", "7002"))
    directory = Path(os.environ.get("GAMES_STORAGE_DIR", str(DEFAULT_DIR)))
    directory.mkdir(parents=True, exist_ok=True)
    handler = partial(GameFileHandler, directory=str(directory))
    server = ThreadingHTTPServer((host, port), handler)
    print(f"games-cdn: serving {directory} on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
