# Architecture — Prompt-to-Game MVP

**Status:** v1.3 (2026-07-15) · implemented in this repo
**Scope:** the game **generation engine** (Anthropic SDK) + a lightweight Django web client + a static games origin. Nothing else.
**Goal it must prove:** AI can reliably turn a natural-language prompt (Arabic or
English) into a genuinely playable, bilingual browser mini-game.

This document is the complete design record: system design, monorepo layout,
domain and component responsibilities, API contracts, storage, the generation
pipeline, the blueprint format, packaging, rendering, technology decisions,
and the roadmap. Architectural ideas from the prior product documents
(constitution, MVP spec, ADRs) are incorporated directly — this is the
implementation of those decisions at MVP scale, not a reference to them.

---

## 1. Architecture at a glance

```
                 ┌────────────────────────────────────────────────────────────┐
                 │        GENERATION SERVICE  (FastAPI + Anthropic SDK, :8000)│
                 │                                                            │
  POST /api/v1/  │   ┌────────── async pipeline orchestrator ────────────┐    │
  generations ───┼──▶│ understand → blueprint → code → GATE → package →  │    │
                 │   │      │ (scope)  (Agent 1) (Agent 2) ▲ │    store   │    │
                 │   │      ▼                     └──────┘ │  (StoragePort)   │
                 │   │     END (out of scope)   retry ≤ N  ▼               │  │
                 │   └───────────────────────────────── END ──────────────┘   │
                 │            │                       │                       │
                 │            ▼                       ▼                       │
                 │   Postgres (metadata, jobs, var/storage/games/{id}/        │
                 │   blueprints, llm_calls)    (S3-mimicking bucket layout)   │
                 └───────────┬───────────────────────┬────────────────────────┘
                             │ REST (JSON,           │ same folder, served by
                             │  server-to-server)    ▼
                 ┌───────────┴───────────┐   ┌──────────────────────────┐
                 │  WEB CLIENT           │   │  GAMES CDN (static, :8002)│
                 │  (Django, :8001)      │   │  <iframe sandbox=        │
                 │  UI: prompt · list ·  │   │   "allow-scripts"> loads │
                 │  play · edit — plus   │   │  the game from this      │
                 │  the pre-dispatch     │   │  dedicated origin        │
                 │  validate (LLM: a     │   │                          │
                 │  game? deliverable?)  │   │                          │
                 └───────────▲───────────┘   └────────────▲─────────────┘
                             │ HTML pages                 │
                             ▼                            │
                          browser ────────────────────────┘
                        cross-origin boundary = real sandbox, even in dev
```

Three deployables, one direction of dependency: the Django client consumes
the FastAPI service's REST API — server-to-server, never the other way
around — and the games CDN is a dumb static origin over the service's
storage folder. No shared database. The generation service owns every bit of
generation logic; the client owns the UI plus one AI call of its own — the
pre-dispatch prompt validation (is the request actually a game, and is its
complexity deliverable?). Games are served on an origin the client's pages
treat as foreign and embed under `sandbox="allow-scripts"`.

### Core invariants (carried over from the governing documents)

1. **Bilingual & RTL by construction** — every blueprint carries `en`+`ar`
   text; the template applies `dir`/`lang`; Arabic-Indic numerals via
   `sdk.formatNumber`. A game that skips localization fails the gate.
2. **Generated code is untrusted** — it runs only inside a sandboxed,
   cross-origin iframe; its only channel out is `postMessage`; the gate
   forbids network/escape APIs on top.
3. **Nothing reaches a user unchecked** — the quality gate sits *between*
   generation and storage. A failing game never gets a URL.
4. **The template and the gate are first-class** — generation quality is
   bounded by them; both are versioned, tested code, not prompts.
5. **Reproducible, no orphans** — every game stores prompt + blueprint +
   template version + model ids; bundles contain exactly five files, no
   dead deps, no lockfiles, no leftovers.
6. **Cost tracked from day one** — every LLM call writes tokens/model/stage
   to a flat `llm_calls` table keyed by job.

---

## 2. Monorepo structure

```
mawdoo3_gaming/
├── services/
│   ├── games-cdn/                   # the games origin — static server over var/storage
│   │   └── serve.py                 #   (bucket+CDN stand-in; stdlib only)
│   └── generation-service/          # Project 1 — the engine (Python)
│       ├── src/generation_service/
│       │   ├── config/              # typed settings (pydantic-settings)
│       │   ├── domain/              # blueprint, entities, errors, ports
│       │   ├── application/         # use cases + background job runner
│       │   ├── infrastructure/
│       │   │   ├── ai/              # Anthropic SDK client, prompts, agents, orchestrator
│       │   │   ├── validation/      # the blocking quality gate
│       │   │   ├── packaging/       # starter-template assembler
│       │   │   ├── storage/         # StoragePort adapters (local → S3/GCS/R2)
│       │   │   └── persistence/     # SQLite repositories
│       │   ├── api/                 # routes, DTOs, error mapping
│       │   ├── container.py         # composition root (DI)
│       │   └── main.py              # app factory
│       ├── tests/
│       ├── pyproject.toml
│       └── .env.example
├── apps/
│   └── web-client/                  # Project 2 — lightweight Django UI client
│       ├── webclient/               # settings (no DB, no sessions), urls, wsgi/asgi
│       ├── games/                   # the UI app
│       │   ├── services/generation_api.py   # THE integration point with the service
│       │   ├── services/prompt_validation.py # pre-dispatch LLM check (Anthropic SDK)
│       │   ├── views.py · urls.py · i18n.py # presentation + ar/en chrome strings
│       │   ├── templates/games/     # home, status, play, error (server-rendered)
│       │   └── static/games/        # css + progressive-enhancement js
│       ├── manage.py
│       ├── pyproject.toml
│       └── .env.example
├── packages/
│   └── starter-template/            # versioned template (shared asset)
│       ├── template.json            # version + contract id
│       ├── CONTRACT.md              # template ↔ game contract (prompt + gate source of truth)
│       ├── index.html.tpl
│       └── runtime/ (engine.js, engine.css)
├── scripts/consistency_test.py      # generate 2 games → compare bundle structure
├── docs/ARCHITECTURE.md             # this document
├── Makefile · README.md · .gitignore
```

**Shared packages — what's deliberately (not) shared.** The only cross-project
package is `starter-template`, because it genuinely is a shared, versioned
asset (the service packages it; its contract document feeds the prompts and
the gate). We do **not** share DTO/model packages between the two projects,
even though both are now Python: the REST API contract is the boundary, and a
shared-schema package would couple the client's release cycle to the engine's
— exactly what the split exists to avoid. If/when a typed client is wanted,
the OpenAPI schema FastAPI already emits (`/openapi.json`) is the generation
point — that is the seam, and it costs nothing today.

---

## 3. Project 1 — Generation Service

### 3.1 Layering (clean architecture)

```
api ──▶ application ──▶ domain ◀── infrastructure
                 ▲                        ▲
                 └────── container.py ────┘   (the only place wiring happens)
```

- **domain/** — `GameBlueprint`, `Game`, `GenerationJob`, `GateReport`,
  `GeneratedGameCode`, error types, and the **ports** (`StoragePort`,
  `GameRepository`, `JobRepository`, `LlmCallLog`). Zero imports from
  infrastructure. The blueprint doubles as the structured-output schema —
  the schema *is* the contract, so there is no mapping drift.
- **application/** — use cases (`StartGeneration`, `RunGeneration`,
  `GetGeneration`, `ListGames`, `GetGame`) and the `BackgroundJobRunner`.
  Depends on ports only; fully unit-testable with fakes.
- **infrastructure/** — adapters: the LangGraph pipeline, the quality gate,
  the template assembler, local-folder storage, Postgres repositories, the LLM
  provider factory.
- **api/** — FastAPI routers + response DTOs + one error envelope. DTOs are
  mapped explicitly from entities; the blueprint is never serialized out.
- **container.py** — the composition root. Constructor injection everywhere;
  nothing else instantiates infrastructure. Swapping Postgres for another
  store, local→S3, or OpenRouter→Anthropic is a container/config change.

### 3.2 Domain responsibilities

| Domain concept | Responsibility |
|---|---|
| **Blueprint** | Internal machine-readable design; AI#2's build spec; the gate's answer key; the reproducibility record. Never exposed via API or bundle. |
| **GenerationJob** | One request's lifecycle: `queued → running → succeeded/failed`, with the live pipeline stage, error envelope, gate report, and token usage. |
| **Game** | A gate-approved, stored, playable artifact + its full provenance (prompt, blueprint, template version, model ids, storage prefix). |
| **GateReport / GateCheck** | Typed result of the blocking gate; `feedback()` renders actionable retry instructions for the code model. |
| **Ports** | The seams: storage, repositories, LLM call log. |

### 3.3 Component responsibilities

| Component | Responsibility |
|---|---|
| `infrastructure/ai/llm.py` | Anthropic SDK client factory (direct API or OpenRouter's Anthropic-compatible endpoint — same SDK, config swap) + `StructuredLlm`: schema-validated structured output via forced tool use, with one corrective retry and per-call token usage. |
| `infrastructure/ai/prompts.py` | The prompt templates (understand / blueprint / code / revise / review) as plain-string builders with the retry-feedback block. Static docs are substituted with `str.replace` so braces in code samples survive. |
| `infrastructure/ai/nodes.py` | The pipeline nodes — Agent 1 (designer: understand/blueprint/revise) and Agent 2 (implementer: code); every LLM call logged to `llm_calls`. |
| `infrastructure/ai/pipeline.py` | Explicit async orchestrator + routing (scope rejection, gate retry loop, failure terminal), streamed stage-by-stage. |
| `infrastructure/validation/gate.py` | The blocking checks (below). Deterministic, cheap, feedback-oriented. |
| `infrastructure/packaging/assembler.py` | Loads the pinned template once (fail-fast), assembles the five-file bundle, embeds the runtime manifest, escapes HTML/JSON. |
| `infrastructure/storage/local.py` | `StoragePort` on a folder that mirrors the bucket layout; traversal-safe. |
| `infrastructure/persistence/` | Postgres schema + repositories (asyncpg pool) for games, jobs, and the flat LLM cost log. |
| `application/job_runner.py` | Tracked asyncio tasks (the future queue/broker seam). |
| `api/routes/play.py` | Serves bundles through the port with CSP + nosniff headers (the CDN stand-in). |

### 3.4 The generation pipeline (multi-agent, Anthropic SDK)

An explicit async orchestrator over a typed `GenerationState` — Agent 1
designs (blueprint), Agent 2 implements (code), and deterministic stages
gate, package and store:

| # | Node | Stage exposed to clients | What happens |
|---|------|--------------------------|--------------|
| 1 | `understand` | `understanding` | One cheap structured call: in scope? (mini-game vs 3D/multiplayer/AAA → reject with a bilingual-friendly reason) · detected language · normalized English `game_concept`. Vague-but-game-like prompts are interpreted, not rejected. |
| 2 | `blueprint` | `blueprint` | **Agent 1** emits `GameBlueprint` as structured output (title ar+en, genre, core rule, rules, controls, tweaks, ui_strings, rendering mode, locale, art direction). |
| 3 | `generate_code` | `code_generation` | **Agent 2** writes `game.js` (+`game.css`) against the template contract (CONTRACT.md injected verbatim + blueprint JSON). On retries the gate's failure feedback is appended. |
| 4 | `validate` | `validation` | The quality gate (below). Pass → package; fail & attempts ≤ N → back to 3 with feedback; exhausted → `gate_failed` terminal. |
| 5 | `package` | `packaging` | Assemble the self-contained bundle from the pinned template. |
| 6 | `store` | `storage` | Write `games/{id}/*` through the StoragePort. |

Each job streams through the orchestrator (`astream` yields after every
node), and the runner persists the stage after each one so polling clients
see live progress. Structured output is enforced with forced tool use — the
Pydantic schema of each artifact IS the tool's input schema, validated at the
API boundary with one corrective retry. A wall-clock timeout
(`GENERATION_TIMEOUT_SECONDS`) bounds the whole run.

**Two-step generation is deliberate** (blueprint before code): it gives the
gate an answer key, makes generation reproducible, and keeps the user
experience direct — the blueprint is agent-facing only.

### 3.5 The quality gate (blocking, deterministic)

| Check | Rule | Why |
|---|---|---|
| `contract.create_game` | `window.createGame =` present | the runtime can boot it |
| `contract.ready` | `sdk.ready()` called | no stuck loading overlay |
| `lifecycle.sdk_managed` | raw `setTimeout/setInterval/requestAnimationFrame/addEventListener/AudioContext/new Audio` **forbidden** | forces the SDK equivalents the engine auto-cleans → leaked-resource defect class is impossible, not just detected |
| `sandbox.forbidden_api` | `fetch/XHR/WebSocket/eval/new Function/cookies/localStorage/indexedDB/window.parent/top/open/import/require/<script` forbidden | untrusted code stays inert even before the iframe sandbox |
| `bundle.self_contained` | no `http(s)://` anywhere | no CDN scripts, fonts, images; bundles run offline |
| `i18n.strings_used` | blueprint has `ui_strings` ⇒ game calls `sdk.t(...)` | Arabic/English actually wired, not hard-coded |
| `bundle.size` | game.js+css ≤ `GATE_MAX_GAME_KB` | runaway output is a defect |
| `syntax.node_check` | `node --check` on game.js (graceful skip if node absent) | parse errors never ship |
| `runtime.smoke_boot` | boot `createGame` headlessly (stubbed DOM+SDK), drive ~2 simulated seconds of frames, pointer and keyboard input; any throw fails with the stack as retry feedback (graceful skip if node absent; skipped for `webgl3d`) | crashes-on-first-frame never ship — `node --check` can't see them |

Failures produce named, actionable feedback lines that go straight back into
the code model for up to `GENERATION_MAX_CODE_RETRIES` attempts. The
deliberate MVP gap: *deep* core-rule correctness (auto-playtest) is deferred —
the blueprint's `core_rule`/`rules` are already stored as the future
answer key, and `FEATURE_LLM_REVIEW` is the reserved flag for an LLM-judge
pass inside the gate.

### 3.6 Blueprint format (internal artifact)

```jsonc
{
  "schema_version": "1.0",
  "title":        { "en": "Number Guess", "ar": "تخمين الأرقام" },
  "genre":        "puzzle",              // arcade|puzzle|memory|quiz|board|runner|shooter|platformer|clicker|word|other
  "summary":      "Guess the secret number…",
  "core_rule":    "After each guess the game says higher or lower; matching the secret number wins.",
  "win_condition":  "Guess the secret number",
  "lose_condition": "Run out of attempts",
  "rules":        ["A secret number 1..100 is chosen", "..."],   // 3–8, individually checkable
  "controls":     [{ "input": "touch", "action": "tap digits to enter a guess" }],
  "difficulty":   "fewer attempts on higher difficulty",
  "rendering":    "dom",                 // canvas for motion games, dom for board/quiz
  "default_locale": "ar",
  "visual_style": "dark background, warm accents, big friendly digits",
  "entities":     ["secret number", "guess input", "attempts counter"],
  "tweaks":       [{ "name": "max_attempts", "description": "...", "value": 7 }],
  "ui_strings":   [{ "key": "you_win", "en": "You win!", "ar": "لقد فزت!" }]
}
```

Flow of each field: `tweaks` → runtime manifest → `sdk.tweaks.*`;
`ui_strings` → manifest → `sdk.t(key)`; `core_rule`/`rules` → codegen prompt +
stored answer key; `title`/`default_locale` → page `<title>`, `lang`, `dir`.
The blueprint is stored as JSON on the game row and never leaves the service.

### 3.7 Starter template & packaging flow

The template provides **infrastructure only** (runtime, lifecycle,
bilingual/RTL harness, SDK, save/share postMessage hooks, cleanup); gameplay
is always bespoke AI output — there is deliberately **no gameplay component
library** (that stays a future quality/scale lever).

Packaging = light assembly, no build step, no installs:

```
index.html.tpl ──(fill __LANG__/__DIR__/__TITLE__/__MANIFEST_JSON__)──▶ index.html
runtime/engine.js  ── copied verbatim (pinned version) ──▶ engine.js
runtime/engine.css ── copied verbatim                 ──▶ engine.css
AI game_js  ──────────────────────────────────────────▶ game.js
AI game_css ──────────────────────────────────────────▶ game.css
```

Exactly five files; the embedded manifest carries only what the runtime needs
(`gameId`, template version, bilingual title, locale, tweaks, strings). The
only dependency of a generated game is the pinned template version →
reproducible builds, and the dead-dependency/leftover-file anti-pattern is
structurally impossible.

### 3.8 Storage design

- **Bodies** (bundles): behind `StoragePort` — `put/get/exists/delete_prefix`.
  MVP adapter is a local folder that **mirrors the bucket key layout**
  (`games/{game_id}/index.html`); the S3/GCS/R2 adapter is the same port +
  config (`STORAGE_BACKEND`, `OBJECT_STORAGE_*`, `CDN_BASE_URL`). When
  `CDN_BASE_URL` is set, `play_url` flips to that origin automatically —
  clients never build storage paths. Local dev runs the `games-cdn` static
  server (:8002) over the same folder, so the dedicated games origin exists
  even in development; the service's `/g` route remains as a fallback.
- **Metadata**: Postgres (`games`, `generation_jobs`, `llm_calls`), accessed
  through an asyncpg pool behind the repository ports. No shared DB with the
  client — API only.
- Generated artifacts under `var/` are gitignored and regenerable;
  reproducibility lives in the DB row (prompt + blueprint + versions), not in
  the files.

### 3.9 API contracts

Base: `http://localhost:8000` · JSON everywhere · errors always
`{"error": {"code", "message"}}`.

```
POST /api/v1/generations                     → 202
  body: { "prompt": "لعبة تخمين أرقام", "locale": "ar"? }
  resp: { "id", "status": "queued", "stage": "queued", "prompt",
          "game_id": null, "error": null, "created_at", "updated_at" }

GET /api/v1/generations/{id}                 → 200
  resp: same shape; stage ∈ queued|understanding|blueprint|code_generation|
        validation|packaging|storage|done; on failure error.code ∈
        out_of_scope|gate_failed|pipeline_timeout|pipeline_error

GET /api/v1/games?limit&offset               → 200
  resp: { "items": [GameResponse], "total", "limit", "offset" }

GET /api/v1/games/{id}                       → 200 GameResponse
  GameResponse: { "id", "title": {"en","ar"}, "genre", "summary",
                  "default_locale", "prompt", "template_version",
                  "play_url", "created_at" }        // no blueprint — internal

POST /api/v1/games/{id}/tweaks               → 202  (chat-edit an existing game)
  body: { "instruction": "make it faster" | "أصعب" }
  resp: GenerationResponse (kind: tweak; game_id set from the start; the
        pipeline revises the blueprint, regenerates the code, re-runs the
        gate, and replaces the bundle in place on success)

GET /g/{game_id}/{file}                      → the bundle (play path; CSP+nosniff)
GET /health                                  → { "status": "ok", ... }
```

Polling (2s) is the MVP notification mechanism — deliberately boring; SSE is
a later drop-in on the same job resource.

---

## 4. Project 2 — Web Client (Django)

A deliberately lightweight, **stateless** Django app: server-rendered pages,
no database, no sessions, no ORM models, no auth (per scope). Every
generation capability comes from the generation service's REST API, consumed
server-to-server; the one AI call the client owns is the **pre-dispatch
prompt validation**. It contains **zero** generation logic; the FastAPI
service can evolve (new pipeline stages, models, storage backends) without
the client changing, and vice versa.

| Piece | Responsibility |
|---|---|
| `webclient/settings.py` | env-driven config (`GENERATION_API_URL`, timeout, default locale, validation LLM provider/model/keys); `DATABASES = {}` — the client owns no state |
| `games/services/generation_api.py` | the **single integration point**: a thin `requests` client over the service API (list/get games, start/poll generations, start tweaks) mapping the service's error envelope to typed exceptions |
| `games/services/prompt_validation.py` | the client's own LLM call (Anthropic SDK, forced tool use): verifies the prompt is actually a game and deliverable mini-game complexity before anything is dispatched |
| `games/views.py` | presentation only — home (prompt + bilingual game cards), generation-progress page, play page, edit action; all delegating to the API client |
| `games/i18n.py` | ar/en strings for the client chrome (RTL default; game data arrives pre-localized from the API) |
| `templates/games/` + `static/games/` | server-rendered pages; mobile-first, RTL-safe CSS (logical properties only); JS as progressive enhancement |

Routes: `/` (home) · `POST /generate/` · `/generations/{job}/` (progress) ·
`GET /api/generations/{job}/` (poll proxy for the progress page's JS) ·
`/games/{id}/` (play) · `POST /games/{id}/edit/` (tweak).

**Pre-dispatch validation** — `POST /generate/` never dispatches blindly: the
Django backend itself sends the prompt to the LLM (one Anthropic-SDK call with
a forced structured verdict) to verify two things — the request is actually a
game, and its complexity is within what the platform can deliver — and
branches: valid → dispatch the generation and redirect to the progress page;
invalid → re-render the homepage with the language-matched rejection reason.
Length limits are checked locally first (no LLM spend on over/under-sized
prompts), and the check fails closed: no verdict → no dispatch. The pipeline's
`understand` stage remains the service's authoritative scope check, so prompts
dispatched straight against the service API get the same scrutiny.

**Generation & edit UX** — both flows share the progress page: a form post
starts the job through the API and redirects to `/generations/{job}/`, which
shows the live pipeline stage (its JS polls the small Django JSON proxy every
3 s; a `<noscript>` meta-refresh keeps it working without JS) and redirects to
the game when the job succeeds. The browser never talks to the FastAPI service
directly — the only exception is the game iframe itself, which is *supposed*
to load from a foreign origin (that is the sandbox model).

### Game rendering flow

```
click card → /games/{id}/
  → <iframe sandbox="allow-scripts" referrerpolicy="no-referrer"
            src="http://localhost:8000/g/{id}/index.html?lang=ar&v=…">
      → engine.js boots: manifest → lang/dir → SDK → window.createGame({mount, sdk})
      → game calls sdk.ready() → plays
      → sdk.gameOver(...) → postMessage → client shows the score line
```

Isolation is double even in dev: the client (:8001) and the game origin
(:8000) differ, and the iframe never gets `allow-same-origin` — so the
generated code can't touch the client's DOM, storage, or cookies; its only
channel is `postMessage`. The production evolution (dedicated
`games.<domain>` + CDN) changes the URL, not the model.

---

## 5. Technology decisions

| Decision | Choice | Rationale (and the alternative rejected) |
|---|---|---|
| Service framework | **FastAPI, async-first** | Bursty IO-bound pipeline; native Pydantic; OpenAPI for free. |
| Orchestration | **Explicit async orchestrator** (a loop and two branches) | The control flow is small enough to read at a glance; each stage is yielded for live progress; no framework between the code and the Anthropic SDK. |
| LLM access | **Anthropic SDK** with forced tool-use structured outputs; **OpenRouter's Anthropic-compatible endpoint by default** (direct Anthropic API = config swap) | Pydantic-validated artifacts at every stage (the schema IS the tool's input schema); one key → many Claude models for the model bake-off. |
| Blueprint-then-code | **Two AI steps** | Answer key for the gate + reproducibility; one extra call is the cost, tracked. |
| Gate style | **Deterministic static checks + `node --check`** | Cheap, zero false-positive-prone LLM judging in the blocking path; the LLM-review pass is a feature flag for later. |
| Template/game line | **Engine owns machinery, model writes only gameplay** | Kills the lifecycle/perf defect classes by construction; keeps generated code small and reviewable. |
| Bundles | **Self-contained static, no deps** | Reproducible; no per-game installs; competitor's dead-dep anti-pattern impossible. |
| Metadata store | **Postgres via asyncpg pool, repository pattern** | Production-grade concurrency behind the repository ports; the swap from the SQLite MVP was a container/config change, not a redesign. |
| Body store | **Local folder behind StoragePort, bucket-shaped keys** | Dev = prod semantics; S3/GCS/R2 = config swap; CDN via `CDN_BASE_URL`. |
| Jobs | **In-process asyncio + polling** | Smallest thing that works; the runner class is the broker seam (Redis env var already reserved). |
| Client | **Django, server-rendered, stateless (no DB/sessions)** | Clean UI/engine split with the REST API as the only boundary; server-side API calls keep the browser off the engine (no CORS surface); Django's template/auth machinery is the ready seam for the platform features (accounts, feed) when they get green-lit. JS only as progressive enhancement. |
| Rendering | **Sandboxed cross-origin iframe, postMessage only** | Untrusted-code rule with browser-enforced isolation, real even in dev. |
| DI | **Hand-rolled composition root** | One `container.py` beats a DI library at this size; constructor injection keeps everything fake-able in tests. |

### Recommended libraries (in use)

Service: `fastapi`, `uvicorn`, `pydantic` v2, `pydantic-settings`,
`anthropic`, `asyncpg`; dev: `pytest`, `pytest-asyncio`, `httpx`, `ruff`.
Client: `django` + `requests` only. Games CDN: stdlib only.

---

## 6. Security posture (MVP-scoped, boundaries ready)

Per scope, no auth/authz/billing/tenancy is implemented — but the boundaries
that would host them exist: every API route resolves through `deps.py` (the
future auth dependency point); `SECRET_KEY`/`SERVICE_TOKEN` are reserved
config; jobs/games carry no user identity yet but ids are UUID-style strings
so an `owner_id` column is additive. What **is** enforced now, because it's
the product's trust model rather than "security features": the untrusted-code
sandbox (gate + CSP headers + cross-origin `sandbox="allow-scripts"` iframe),
storage-key traversal guards, prompt length caps, and Django's stock CSRF
protection on every form post. The API's CORS allowlist is empty by default —
the Django client calls it server-to-server, so no browser origin needs
access at all.

---

## 7. Development roadmap

**Phase 0 — repo & template (done here).** Monorepo, versioned starter
template + contract, gate + assembler + storage with tests.

**Phase 1 — pipeline online (done here).** LangGraph pipeline, job API, play
path, web client. *Exit test:* `make demo PROMPT="Build a Snake game"` →
playable game in the client.

**Phase 2 — prove the thesis (next).** Run the 10–20 canonical prompts
(Snake, Flappy, memory, quiz, لعبة تخمين أرقام, لعبة جمع العملات…) across 2–3
models through OpenRouter; measure gate pass-rate, retries, cost/game
(`llm_calls`), Arabic/RTL quality by hand. This is the model bake-off that
also anchors the future cloud/region choice. *Exit:* ≥80% first-or-second
attempt pass rate on the canonical set, cost/game known.

**Phase 3 — harden the gate.** Add the LLM-review pass behind
`FEATURE_LLM_REVIEW` (core-rule holds? tweaks consumed?); ~~add a headless
smoke-boot~~ (done: the `runtime.smoke_boot` gate stage boots every game in a
stubbed-DOM Node harness — a full-browser Playwright pass, `game_ready` +
console-error assertions, remains the upgrade path); grow the golden-game
fixture set.

**Phase 4 — production shape (only after go).** S3/R2 adapter + CDN +
dedicated games origin; Postgres repositories; Redis-backed job queue; SSE on
the job resource; then — and only then — the platform features (accounts,
share links, tweak-and-rebuild API, feed/remix) each as an explicit scope
decision.

Deferred non-goals stay non-goals: component library, discovery feed, remix,
profiles, monetization, 3D, native apps, deep auto-playtest certification.

---

## 8. Environment configuration

Both projects ship a complete `.env.example` with defaults, placeholders, and
per-variable explanations:

- Service: [services/generation-service/.env.example](../services/generation-service/.env.example)
  — app/env/logging · Anthropic SDK access (OpenRouter gateway or direct) +
  per-stage models · storage (local S3-mimic + object-store/CDN) · Postgres ·
  template path · gate/retry/timeout knobs · feature flags · Redis · security
  placeholders.
- Client: [apps/web-client/.env.example](../apps/web-client/.env.example)
  — Django secret/debug/hosts, generation API URL + timeout, default locale,
  page size.
