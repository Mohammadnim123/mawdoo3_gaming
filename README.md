# Mawdoo3 Gaming — Prompt-to-Game MVP

Turn a natural-language prompt (Arabic or English) into a **playable, bilingual
browser mini-game** — and prove the generation engine works. Two independent
services, one direction of dependency:

```
"Make a Flappy Bird clone"      ─┐  validate (LLM: a game? deliverable?) ── no ─▶ error to user
"لعبة تخمين أرقام"               ├──▶  Web Client ────HTTP────▶  Generation Service ──▶ game bundle ──▶ Games CDN
"Create a memory card game"     ─┘   (Django, UI + the        (FastAPI + Anthropic SDK)  (S3-mimic folder)  (static, :8002)
                                      validation LLM call)
                                          │                                                                     ▲
                                          └───────────────── <iframe sandbox="allow-scripts"> ──────────────────┘
```

## Monorepo layout

| Path | What it is |
|------|------------|
| [services/generation-service/](services/generation-service/) | **The engine** — FastAPI service built on the **Anthropic SDK**: intake (authoritative scope check) → Agent 1 (blueprint) → Agent 2 (code) → quality gate (static + runtime smoke boot) → package → store → REST API. The single source of truth for all generation logic. No UI. |
| [services/games-cdn/](services/games-cdn/) | **The games origin** — dedicated static server over the S3-mimicking storage folder (the bucket+CDN stand-in). Generated games are served — and sandboxed — from this separate origin. |
| [apps/web-client/](apps/web-client/) | **The UI** — lightweight Django client: homepage with prompt input, games list, progress page, sandboxed play page, chat-edit of existing games. Owns the **pre-dispatch LLM validation** — before dispatching, it sends the prompt to the LLM to verify the request is actually a game and its complexity is deliverable; invalid prompts get an immediate, language-matched error. Everything else goes through the service's REST API; no generation logic, no database. |
| [packages/starter-template/](packages/starter-template/) | The **versioned starter template** every generated game inherits (runtime, lifecycle, RTL/i18n, SDK). Infrastructure only — gameplay is always AI-generated |
| [scripts/consistency_test.py](scripts/consistency_test.py) | **Consistency test** — generates two different games and verifies the bundles are structurally uniform (same file set, byte-identical pinned runtime, same template/manifest shape, bespoke gameplay code). `make consistency` |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Full architecture: system design, pipeline, blueprint format, storage, API contracts, roadmap |

## Quickstart

Prerequisites: Python ≥ 3.11, an [OpenRouter](https://openrouter.ai) API key
(Node ≥ 18 optional — the gate uses `node --check` when available).

```bash
make setup                 # both venvs + pip install, copy .env files
# edit services/generation-service/.env → set OPENROUTER_API_KEY
# edit apps/web-client/.env             → set OPENROUTER_API_KEY (prompt validation)
#   (or *_AI_PROVIDER=anthropic + ANTHROPIC_API_KEY — both run on the Anthropic SDK)

make dev-service           # generation service on http://localhost:8000
make dev-cdn               # games origin on       http://localhost:8002  (second terminal)
make dev-web               # web client on         http://localhost:8001  (third terminal)
```

Open <http://localhost:8001>, type a game idea (Arabic or English). The
prompt is LLM-validated first — if it isn't a game (or is beyond mini-game
scope) you get the reason immediately; otherwise watch the pipeline progress,
then play the game — and keep editing it from its page ("make it faster",
"أصعب"…).

Generation is also scriptable straight against the service API:

```bash
make demo PROMPT="Build a Snake game"
# or Arabic:
make demo PROMPT="لعبة جمع العملات"
# or interactively: open http://localhost:8000/docs
```

```bash
make test                  # both test suites (service + web client)
make consistency           # generate 2 games, verify structural consistency
```

## The one-paragraph architecture

The **generation service** owns the whole pipeline as an explicit async
orchestrator over **Anthropic SDK** calls: an intake stage classifies scope
and language; **Agent 1** emits a structured, machine-readable **blueprint**
(internal artifact — users never see it); an optional **painting stage**
(Gemini image generation, `GEMINI_API_KEY`) turns the blueprint's art briefs
into a full-scene `bg.png` backdrop plus up to 3 transparent hero sprites
(`sprite_<name>.png`, flood-fill chroma cutout) bundled with the game — absent
or failing, games degrade to procedural rendering; **Agent 2** writes bespoke
gameplay code against the **starter template contract**; a **blocking quality gate**
verifies the contract, sandbox rules, lifecycle discipline, localization,
syntax, and a headless **runtime smoke boot** (failures feed back into capped
retries); the packager assembles a **self-contained static bundle** on the
pinned template; the bundle is written through a **storage port** into a local
folder that **mimics the S3 bucket layout** (the cloud adapter is a config
swap); metadata (prompt, blueprint, versions, per-call LLM cost) lands in
Postgres. The **games CDN** server exposes that folder as a dedicated static
origin. The **web client** is a stateless Django app that runs the
**pre-dispatch LLM validation** itself (one Anthropic-SDK call: is the request
actually a game, and is its complexity deliverable?), talks to the service's
REST API for everything else — start generations, poll job progress, list
games, submit chat-edits — and renders games in a `sandbox="allow-scripts"`
cross-origin iframe pointed at the games origin — generated code is untrusted,
always.
