# Codply Migration — Master Plan

**Goal.** Make the entire user experience of this platform *functionally identical to
Codply* (internal codename "ForgePlay"), while keeping our **FastAPI generation-service
as the source-of-truth engine**. A visitor should believe they are using Codply; under
the hood it runs on our architecture.

This document is the north star for the migration program. It records the locked
decisions, the target architecture, the Django↔FastAPI contract, the data model, and
the phased delivery plan. Keep it current as phases land.

---

## 1. Locked decisions (kickoff, 2026-07-16)

| # | Decision | Choice |
|---|---|---|
| D1 | **Frontend strategy** | **Hybrid.** Django server-renders the shell + most pages and owns all data/auth/CMS. **React islands** power only the two genuinely-interactive surfaces: the live **generation workspace** and the **player / TikTok overlay feed**. |
| D2 | **Scope** | **Full Codply parity** — the complete surface (social graph, comments, follows, saves, notifications, remix, credits/billing, dashboard/payouts). Delivered in sequenced phases so value ships early; the *target* is everything Codply does. |
| D3 | **Generation engine** | **Keep our FastAPI blueprint pipeline as the base and graft Codply's features + best pipeline techniques onto it** — SSE + live transcript, clarifying questions, immutable versions, checkpointed self-heal, one shared QA authority. No rewrite; selective, maintainable adoption. |
| D4 | **Brand** | **Codply.** Replace the current "Mawdoo3 Games / ألعاب موضوع" branding with Codply's. Keep bilingual EN/AR + RTL. |
| D5 | **Auth** | **Django session auth** (httpOnly cookie), same-origin — React islands ride the same session, no JWT/BFF juggling. OAuth (Google/Discord/Apple) + email/password + magic link + password reset, mirroring Codply's login UX. |
| D6 | **Reuse** | Port Codply's `@codply/ui`, `@codply/game-runtime`, and (adapted) `@codply/contracts` into our repo for the islands and the Django design-system build. Do **not** reproduce the design system by hand. |

---

## 2. Target architecture

```
Browser
 ├─ Django (server-rendered, owns data/auth/CMS/SEO):
 │    shell/nav (TopBar, MobileTabBar, Footer) · landing+hero · feed (grid) ·
 │    game page /g/{slug} (SEO + JSON-LD) · profiles /u/{handle} · account · billing ·
 │    dashboard · notifications · search · legal · auth pages · Django admin (CMS/moderation)
 │    styling: Tailwind v4 build of @codply/ui tokens → Django static
 │
 ├─ React islands (Vite build, mounted into Django templates, reuse @codply/* packages):
 │    • Workspace  — live SSE generation, ClarifyCards, agent transcript, chat edit,
 │                   Code view (CodeMirror), Version tree, Console
 │    • Player + overlay feed — sandboxed GamePlayer, TikTok-style vertical navigation
 │
 └─ same-origin session cookie ──▶ Django is the API + BFF (incl. SSE proxy)
        │
        ├─ Postgres 16 — users/auth, games (product record), game_versions, generation_jobs
        │    (mirror), plays, likes, saves, shares, comments, follows, notifications,
        │    credit_ledger, subscriptions, creator_earnings, reports, feature_flags
        │
        ├─ Redis 7 — SSE relay pub/sub, rate limits, quota, idempotency (added as needed)
        │
        └─ HTTP (+ service token) ──▶ FastAPI generation-service  [OUR ENGINE — KEPT]
                 understand → (clarify) → blueprint → paint(Gemini) → codegen → gate →
                 package → store; owns blueprints, jobs, bundles, immutable versions
                 └─ writes bundles ──▶ games-CDN (foreign origin, sandboxed play surface)
```

### Ownership split (mirrors Codply's api-vs-workers split)
- **FastAPI generation-service** owns: generation/edit jobs, the internal `GameBlueprint`
  (never exposed), painted art, the code bundle, **immutable versions**, and the play
  surface (via games-CDN). It is the "how the game is made and served" service.
- **Django** owns the **product layer**: user accounts, the `Game` product record
  (slug, owner, visibility, social counts, cover, lineage) referencing the FastAPI game
  id + play_url, the social graph, notifications, credits/billing, CMS/moderation, and
  the entire rendered UX.

---

## 3. Django ↔ FastAPI contract

Django is the only caller of the generation-service (server-to-server, authenticated with
a shared `SERVICE_TOKEN`). Existing endpoints are kept; new ones are added for parity.

**Existing (keep):**
- `POST /api/v1/generations` `{prompt, locale?}` → `202 {id,...}`
- `GET  /api/v1/generations/{id}` → job snapshot (polling)
- `POST /api/v1/games/{id}/tweaks` `{instruction}` → `202`
- `GET  /api/v1/games` , `GET /api/v1/games/{id}`

**New (engine enhancements — see §6):**
- `GET  /api/v1/generations/{id}/stream` — **SSE**; events `step|questions|progress|activity|file|message|heal|done|failed|heartbeat`, each with a `seq` id; `Last-Event-ID` replay from a persisted event log.
- `POST /api/v1/generations/{id}/answers` `{answers}` — resume an `awaiting_input` job.
- `POST /api/v1/generations/{id}/cancel`
- `GET  /api/v1/games/{id}/versions` — immutable version list `[{id,version_no,parent_id,change_summary,created_at,play_url}]`
- `GET  /api/v1/games/{id}/versions/{vid}/source` — `{source_html}` (Code view)
- `POST /api/v1/games/{id}/rollback` `{version_id}`

Django proxies `/stream` straight through to the browser/islands as SSE (unbuffered).
The browser never talks to the generation-service directly; `play_url` alone points at
the games-CDN foreign origin.

---

## 4. Data model (Django / Postgres) — target

Modeled on Codply's schema (`codply/packages/core-py/.../db/models.py`), trimmed to what
each phase needs. Django apps:

- **accounts**: `User` (email, handle, display_name, avatar_url, bio, role, banned_at,
  credits_balance_cents, daily_gen_quota, follower/following counts, auth fields),
  `AuthAccount` (OAuth), `LoginToken` (magic-link/verify/reset, hashed, single-use).
- **games**: `Game` (owner, slug, title, genre, summary, visibility[public|unlisted|private],
  status[draft|live|failed|removed], cover_url, service_game_id → FastAPI id, current_version,
  remixed_from, denormalized play/like/comment/save/share/remix counts, active_session hint),
  `GameVersion` (version_no, parent, change_summary, play_url, service_version_id, gdd hidden),
  `GenerationJobRef` (local mirror of a FastAPI job: type, status, steps cache, error).
- **social**: `Play`, `Like`, `Save`, `Share`, `Comment` (+ `CommentLike`), `Follow`,
  `Notification`, `Report`.
- **billing**: `CreditLedger` (append-only, idempotent), `Subscription`, `CreatorEarning`,
  `PayoutRequest`.
- **core**: `FeatureFlag`, `AuditLog`, trending (matview or scheduled recompute).

---

## 5. Phased delivery (target = full parity)

Each phase ends shippable and independently demoable.

**Phase 0 — Foundation** *(scaffolding, no product features yet)*
- Frontend build pipeline: Tailwind v4 + `@codply/ui` tokens → Django static; Vite island
  build wired into Django templates; port `@codply/ui`, `@codply/game-runtime`,
  `@codply/contracts` into the repo.
- Base template + AppChrome (TopBar, MobileTabBar, Footer), theme (dark/light/auto,
  pre-paint script), i18n/RTL (EN/AR, `fp_locale` cookie, server-resolved `<html lang dir>`).
- Postgres wired; Django apps split (accounts, games, social, billing, core); base migrations.
- Harden the generation-service client + add `SERVICE_TOKEN` auth on both sides.

**Phase 1 — Auth + core loop + basic feed + profiles + versions**
- Accounts: signup/login/logout, OAuth, magic link, password reset, `/me`, `/u/{handle}`.
- Engine enhancements #1: **SSE stream**, **clarifying questions (pause/resume)**,
  **immutable versions**.
- Workspace island: composer → clarify cards → live transcript/timeline → player reveal →
  chat edit + Code view + Version tree.
- Landing hero + feed grid (server-rendered), game page `/g/{slug}` + player island + SEO,
  overlay player island, publish/visibility, ShareBar, basic remix.

**Phase 2 — Social platform**
- Likes, saves, shares, threaded comments, follows, notifications, following-feed,
  trending, search (pg_trgm), full remix lineage, creator profile stats.

**Phase 3 — Credits & billing & dashboard**
- Credit ledger + daily quota/claim, subscription/checkout (fake-provider parity),
  plan meter, upsell/exhausted dialogs, creator dashboard (overview/games/payouts), earnings.

**Phase 4 — Engine quality parity + platform polish**
- Port Codply pipeline techniques into our engine: checkpointed self-heal loop, one shared
  QA authority, richer real-tool-event transcript (file/message/heal + captured frames),
  cover-art-from-gameplay-frame. Admin/CMS + moderation (takedowns, reports, flags),
  robots/sitemap SEO, legal pages, status page.

**Phase 5 — Cutover & retire Codply**
- Parity QA vs Codply, data migration if any, flip DNS/branding, deprecate Codply.

---

## 6. Generation-engine enhancements (detail)

Added to the FastAPI service, keeping the existing `understand→blueprint→paint→codegen→
gate→package→store` pipeline:

1. **SSE + event log.** Persist each stage/progress step as an ordered event row; expose
   `/generations/{id}/stream` that replays `seq > Last-Event-ID` then live-relays. In-process
   pub/sub for single-worker; Redis pub/sub when scaled. This mirrors Codply's lossless
   replay design (its single strongest infra idea).
2. **Clarifying questions.** New pausable step: pipeline can emit `clarifying_questions[]`
   (2–3, one-tap, smart default so "Surprise me" skips), persist state, set job
   `awaiting_input`; `/answers` resumes. Requires making the orchestrator checkpoint/resume.
3. **Immutable versions.** Tweaks write to `games/{id}/v{n}/` instead of overwriting;
   record a version row; `play_url` → current version. Enables the Version tree + rollback.
4. **Synthesized agent transcript.** Emit friendly activity/message rows from stage
   transitions + LLM steps ("Designing your game", "Painting the background", "Writing
   gameplay code", "Testing & fixing a crash when the player jumped off-screen").
5. **(Phase 4) Adopt Codply quality techniques**: checkpointed self-heal state machine,
   shared QA authority (agent smoke test answers the same gates the pipeline enforces),
   ship-what-works / soft-pass semantics, cover art rendered from a real gameplay frame.

---

## 7. Key source references

- Target frontend: `codply/apps/web/src/**` · design system `codply/packages/ui/src/{tokens.ts,styles.css}`
- Target backend/engine techniques: `codply/apps/workers/.../pipeline/{runner,steps}.py`, `.../qa/gates.py`, `codply/apps/api/.../streams.py`, `codply/apps/api/API.md`
- Contracts: `codply/packages/contracts/src/{schemas,sse,client}.ts`
- Our engine: `services/generation-service/src/generation_service/**` (see docs/ARCHITECTURE.md)
- Our current UI: `apps/web-client/**`

---

## 8. Risks & notes
- **Pausable pipeline**: our orchestrator is a straight async run; clarify pause/resume and
  checkpointed heal need it to be resumable. Design this carefully in Phase 1.
- **Two `codply/` copies exist** (repo-root `codply/` and `~/qalam/codply`). Treat the
  standalone as read-only reference; port from it into our tree deliberately.
- **Fidelity vs. hybrid seams**: keep island ↔ server transitions seamless (shared tokens,
  no flash of unstyled content, consistent nav).
- **Don't over-adopt the engine**: D3 says selective. The blueprint pipeline stays; we add
  capabilities, we don't swap the runtime for Codply's single-session Agent SDK model.

---

## 9. Build status (2026-07-16)

**Shipped & verified** on `feat/codply-migration` — 116 automated tests green
(79 generation-service + 37 Django) + live end-to-end smoke of all servers:

- **P0 foundation** — design-system build, Django app split (`core/accounts/games/social/billing`),
  custom email `User`, all data models migrated, Codply shell (TopBar/MobileTabBar/Footer, dark/light
  theme, EN/AR + RTL, webfonts), service client + `SERVICE_TOKEN` auth (both sides).
- **P1 core loop** — auth (login/signup/logout, magic-link, reset, `/me`, `/u/{handle}`); engine
  **SSE stream + persisted event log** (replay + live + `Last-Event-ID`); Django **BFF**
  (create → draft game → live workspace → lazy finalize → game page); landing hero + localized feed;
  publish/visibility; chat-edit; remix.
- **P2 social** — likes, saves, shares, threaded comments (+delete), follows (+counters +
  notifications), following-feed, notifications page, search.
- **P3 billing** — credit ledger, idempotent daily claim, daily generation-quota gate, fake Pro
  checkout, creator dashboard, settings.
- **P4 polish** — robots.txt, sitemap.xml, `/status`, `/privacy`, `/terms`, Django admin/CMS.
- **QA** — `tests/test_service_qa.py` (async job lifecycle + SSE replay + service-token boundary,
  offline/deterministic) + full suites + live smoke (web+engine+cdn, authed flow).

### How to run
```bash
make setup                 # venvs + deps + npm install + CSS build + migrate (sqlite dev)
make dev-service           # engine  :8000   (needs OPENROUTER_API_KEY/ANTHROPIC for real generation)
make dev-cdn               # games origin :8002
make dev-web               # web app :8001
make test                  # 116 tests (engine + web)
make build-web             # recompile design-system CSS after template/class changes
```
DB: SQLite dev by default (`apps/web-client/var/codply.sqlite3`); set `POSTGRES_DB` (+`POSTGRES_*`)
to switch to Postgres. Redis not required in dev (SSE uses in-process pub/sub).

### Deferred (documented, not blocking a working product)
- **Engine clarifying-questions** (pausable/resumable pipeline) — invasive + needs a live LLM key to
  verify pause/resume; the Django `awaiting_input` plumbing is ready when the engine emits `questions`.
- **True engine-level immutable version bundles** (versioned CDN storage paths) — the Django
  `GameVersion` catalog + version list UX already exist; the engine still replaces bundles in place on tweak.
- **React-island upgrade + TikTok overlay/vertical feed** — the interactive surfaces are currently
  server-rendered + vanilla-JS (EventSource). The server contract (`/studio/jobs/<id>/stream` SSE +
  `/status` finalize JSON) is island-ready, so this is a drop-in later with no backend change.
- **Full production cutover / retire Codply** — after the above + a real generation smoke with keys.
