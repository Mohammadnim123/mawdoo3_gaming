# CLAUDE.md

Guidance for coding agents working in this repository. Keep it current.

## What this is

An AI platform that turns a natural-language prompt (Arabic or English) into a
**playable, bilingual browser mini-game**. See [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)
for the business/architecture summary and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
for the full design.

## Critical rules

- **`codply/` is a REFERENCE PROJECT ONLY.** Do not edit it, ship it, or treat
  it as part of this codebase. Consult it only to understand architecture,
  UI/UX, workflows, and implementation patterns. See
  [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md#3-reference-project).
- **The generation service is the source of truth** for all generation logic.
  The web client holds no generation logic and no game database.
- **Generated game code is untrusted** — always served from the games origin
  and rendered in a cross-origin `sandbox="allow-scripts"` iframe.

## Layout

| Path | What it is |
|------|------------|
| [services/generation-service/](services/generation-service/) | The engine — FastAPI + Anthropic SDK pipeline (intake → blueprint → code → quality gate → package → store). REST API, no UI. |
| [services/games-cdn/](services/games-cdn/) | Dedicated static origin serving generated games (S3+CDN stand-in). |
| [apps/web-client/](apps/web-client/) | Django UI. Owns pre-dispatch LLM prompt validation; serves the `/api/v1` contract and React islands (`frontend/`). No generation logic. |
| [packages/starter-template/](packages/starter-template/) | Versioned starter template every generated game inherits. |
| [codply/](codply/) | **Reference only** — see critical rules above. |
| [docs/](docs/) | Architecture, Codply migration plan, cutover scorecard. |

## Commands (via [Makefile](Makefile))

```bash
make setup          # both venvs + deps + copy .env files
make dev-service    # generation service  :8000
make dev-cdn        # games origin         :8002
make dev-web        # web client           :8001  (also: make build-web to compile islands/CSS)
make test           # both suites (make test-service / test-web)
make lint           # ruff over both projects
make migrate-web    # Django migrations
make demo PROMPT="Make a Flappy Bird clone"   # generate straight against the API
make consistency    # generate 2 games, verify structural consistency
```

## Conventions

- Python ≥ 3.11; each service has its own `.venv`. Lint with `ruff`.
- Both LLM paths run on the Anthropic SDK (OpenRouter or Anthropic provider).
- Keep the web client stateless: everything but prompt validation goes through
  the generation service's REST API.
