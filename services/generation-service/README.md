# Generation Service

FastAPI + LangGraph service that owns the complete prompt-to-game pipeline:

```
prompt → understand → blueprint (AI#1) → code (AI#2) → QUALITY GATE (blocking)
       → package (starter template) → store (StoragePort) → metadata → REST API
```

## Run

```bash
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
cp .env.example .env        # set OPENROUTER_API_KEY
.venv/bin/python -m generation_service
# → http://localhost:8000/docs
```

## Layout (clean architecture)

```
src/generation_service/
├── config/           # typed settings (pydantic-settings), env-driven
├── domain/           # blueprint, entities, errors, ports — zero infrastructure imports
├── application/      # use cases + background job runner
├── infrastructure/
│   ├── ai/           # LLM factory, prompts, LangGraph state/nodes/pipeline
│   ├── validation/   # the blocking quality gate
│   ├── packaging/    # starter-template assembler (self-contained bundles)
│   ├── storage/      # StoragePort adapters (local folder now, S3 later)
│   └── persistence/  # SQLite repositories (games, jobs, flat llm_calls log)
├── api/              # FastAPI routes, DTOs, error mapping
├── container.py      # composition root — all wiring lives here
└── main.py           # app factory
```

Dependency rule: `api → application → domain ← infrastructure`; only
`container.py` knows concrete adapters.

## API

| Method & path | Purpose |
|---|---|
| `POST /api/v1/generations` | Start a generation job (202 + job id) |
| `GET  /api/v1/generations/{id}` | Poll job status/stage/error |
| `GET  /api/v1/games` | List generated games (metadata + play_url) |
| `GET  /api/v1/games/{id}` | One game's metadata |
| `GET  /g/{game_id}/{file}` | Serve the stored game bundle (play path) |
| `GET  /health` | Liveness |

## Tests

```bash
.venv/bin/python -m pytest -q
```

Covers the quality gate (pass + every rejection class), the assembler
(bundle completeness, manifest, no blueprint leakage), local storage
(roundtrip, traversal guard), the blueprint schema, and a full app boot
through the real lifespan/container.
