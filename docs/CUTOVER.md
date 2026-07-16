# P5 — Parity QA & Codply Cutover Plan

Status date: 2026-07-16, **second pass — pixel-parity rebuild** (branch
`feat/codply-migration`).

Goal restated: a visitor believes they are using Codply; under the hood the
platform is our Django web tier + our FastAPI generation engine. This document
is the parity scorecard against Codply and the checklist to retire it.

## 0. Second pass (pixel-parity rebuild) — what changed

The first pass reached functional parity with hand-written templates/islands.
The second pass rebuilt the user-facing layer to be **pixel-identical**:

- **Django `api` app** serves Codply's exact JSON contract at `/api/v1/*`
  (shapes from `frontend/src/vendor/contracts/schemas.ts`; session cookie +
  `X-CSRFToken`; `{error, message, details}` envelopes). 36 contract tests.
- **Every screen is a verbatim port of Codply's React components**, mounted
  as islands (15 vite entries: workspace, create, feed, game, overlay,
  account, settings, billing, dashboard, notifications, search, profile,
  auth, chrome, legal). Codply's `@codply/{ui,game-runtime,contracts}`
  packages are vendored under `frontend/src/vendor/` with vite aliases;
  Next.js is shimmed (`frontend/src/next-shim/`). The full bilingual i18n
  catalog, domain services/hooks/stores are ported verbatim.
- **Chrome** (topbar/tabbar/footer) stays server-rendered with
  reference-exact markup; a chrome island hydrates the interactive parts
  (search combobox, notification bell, account menu w/ Credits dialog +
  daily claim) with a seeded query cache — no flash.
- **Previously "deliberate differences" are now shipped**: editable Code
  view (lint-gated `PUT /source` → new immutable version; the editable file
  is `game.js`), live draft view (`GET /jobs/{id}/draft` + `file` SSE
  events), screenshot/image chat attachments (in-frame canvas capture via
  bridge v1 + `image_base64` → LLM image blocks), console forwarding
  (starter-template `engine.js` v1.1.0 speaks Codply bridge v1: console/
  error/pause/resume/capture, legacy envelope kept), cover art
  (`cover.png` from the painted background, procedural SVG fallback),
  play-count pings (≥5s active play, 30-min session dedupe).
- **Engine pipeline untouched** (game quality preserved); all engine work is
  additive hooks/endpoints: draft store, event-log JSON, source edits,
  tweak images, covers, step-completion frames.

---

## 1. Parity scorecard vs Codply

Legend: ✅ shipped & verified · 🟡 shipped with a documented difference · ⬜ not ported (deliberate)

### Identity & chrome
| Surface | Codply | Ours | Notes |
|---|---|---|---|
| Brand (logo, wordmark, tokens, dark/light, fonts) | — | ✅ | `@codply/ui` tokens ported to Tailwind v4 (`frontend/src/codply-ui.css`); lucide Gamepad2 logo; Space Grotesk/Inter/JetBrains Mono + Tajawal |
| TopBar / MobileTabBar / Footer | — | ✅ | server-rendered chrome |
| EN/AR + RTL | Codply: EN (+vendored Tajawal) | ✅ | full bilingual catalog `core/i18n.py`, `fp_locale` cookie, `<html lang dir>` |
| Theme dark/light/auto with pre-paint script | — | ✅ | |

### Auth & accounts
| Login/signup/logout, magic link, password reset | ✅ | ✅ | Django session cookie (D5) instead of JWT+BFF cookie |
| OAuth (Google/Discord/Apple) | ✅ | ✅ | provider stubs behind the same `/auth/oauth/<p>/start` routes; enable per env |
| `/me`, profile `/u/<handle>`, avatar/bio/handle | ✅ | ✅ | |

### Creation loop (the workspace)
| Surface | Codply | Ours |
|---|---|---|
| Prompt composer (hero + feed + create) | ✅ | ✅ |
| Live SSE generation with lossless replay (`Last-Event-ID`) | ✅ | ✅ engine event log + Django SSE proxy |
| Step timeline with friendly labels | ✅ | ✅ `step` events (enhancing/planning/assets/codegen/qa/publishing) |
| **Clarifying questions** (pause → one-tap answers → resume, Surprise me) | ✅ | ✅ engine `awaiting_input` + `/answers`; verbatim ClarifyCards |
| Agent transcript (activity/file/message rows) | ✅ (real tool events) | ✅ step (running/completed) + `file` + `heal` narration folded into the verbatim GenerationCard/PastJobCard; snapshot transcript via engine event-log JSON |
| Stop / cancel | ✅ | ✅ engine `/cancel`, verbatim Stop button |
| Chat edits (per-game mutex, in-place) | ✅ | ✅ tweak pipeline + one-active-job guard |
| **Immutable versions + version tree + rollback** | ✅ | ✅ engine `games/{id}/v{n}` bundles; verbatim HistorySheet w/ confirm + memory reset |
| Code view (CodeMirror, file tabs) | ✅ editable index.html w/ lint gate | ✅ verbatim CodeView; editable file is `game.js` (template owns index.html); `PUT /source` → gate 422 findings → new immutable version |
| Live draft code view while generating | ✅ | ✅ `file` SSE events + `GET /jobs/{id}/draft` polled by the verbatim DraftCodeView (snapshot at codegen/package, not token-streamed) |
| Console pane | ✅ console forwarding | ✅ `engine.js` v1.1.0 forwards `console.*` + errors via bridge v1; verbatim ConsolePane w/ filters + Ask-AI-to-fix |
| Screenshot-to-chat, image attachments | ✅ | ✅ in-frame canvas capture (bridge `capture`) + upload; `image_base64` on tweaks reaches the LLM as an image block (server-side render capture stubbed 404 → client falls back gracefully) |

### Player & feed
| Sandboxed player (foreign origin + `sandbox="allow-scripts"`) | ✅ | ✅ identical double isolation |
| Ready watchdog, reload card, fullscreen | ✅ | ✅ React GamePlayer |
| **TikTok-style vertical overlay feed** (swipe / arrows / rail, infinite paging, URL sync) | ✅ | ✅ verbatim PlayerOverlay; `/g/` links intercepted in-place on the feed AND site-wide via the chrome island |
| Feed (For You / New / Trending / Following, genre filter) | ✅ | ✅ verbatim FeedScreen (inline comments, optimistic actions, infinite scroll) |
| Game page SEO (OG, JSON-LD), share bar, copy link | ✅ | ✅ full VideoGame + interactionStatistic + BreadcrumbList; verbatim ShareBar (X/WhatsApp) |
| Play-count ping | ✅ | ✅ `POST /games/{id}/play` — ≥5s active play, 30-min session dedupe, feed/direct/studio sources |

### Social
| Likes, saves, shares, threaded comments (+delete) | ✅ | ✅ + comment edit w/ history dialog, comment likes, replies, tombstones, pagination |
| Follows + notifications + following feed | ✅ | ✅ notifications JSON + unread badge (99+) + explicit mark-read |
| Remix (+ lineage, counts) | ✅ | ✅ verbatim RemixButton dialog w/ first-change message |
| Report game | ✅ | ✅ verbatim ReportMenu → `POST /report` |
| Search | ✅ (pg_trgm) | 🟡 LIKE-based on SQLite dev; pg_trgm when Postgres is enabled |

### Billing & dashboard
| Credit ledger, daily claim, quota gate | ✅ | ✅ |
| Pro checkout | ✅ (provider) | 🟡 fake-provider parity (swap in real PSP at launch) |
| Creator dashboard, settings | ✅ | ✅ |

### Platform
| Admin/CMS + moderation (reports, takedowns) | ✅ | ✅ Django admin |
| robots.txt, sitemap.xml, /status, legal pages | ✅ | ✅ |
| Engine quality: checkpointed retries, shared QA gate authority, ship-what-works | ✅ | ✅ our gate + best-effort salvage + `heal` narration |
| Cover art | ✅ from gameplay frame | ✅ from the game's own painted background (`cover.png`), procedural SVG fallback; gameplay-frame capture deferred (needs headless browser) |

---

## 2. Verification evidence (second pass)

- **226 automated tests green**: 120 engine (adds draft/events/source-edit/
  tweak-image/cover coverage) + 106 Django (adds 36 contract-API tests +
  chrome/legal/studio-route regression tests). `make lint` clean both sides.
- **Live HTTP smoke** (all three dev servers, real CSRF+session): 28 checks —
  signup/login/session-shim, feed w/ viewer state, like/save, comment →
  reply → edit → history → comment-like → thread shape, play-ping dedupe,
  follow → profile → notifications unread/read, claim-daily → 409 conflict,
  ledger, subscription, suggested, search, report, logout.
- **Real-generation smoke** (real LLM): create (AR locale) → done → v1 →
  publish via PATCH → chat edit **with image attachment** → v2 → chat
  history w/ per-job terminal states → hand-edited source → gate → v3
  ("Hand-edited") → malicious source → 422 findings → rollback to v1 →
  `cover.png` generated and served from the CDN origin w/ CORS; draft
  files + `file`/step-completion events verified in the event log.

## 3. Remaining for production cutover

1. **Infra**: Postgres (`POSTGRES_*` env) + Redis for SSE relay when the web
   tier scales past one process; S3-compatible bucket + real CDN in front of
   the games origin (`CDN_BASE_URL`); `SERVICE_TOKEN` set on both sides.
2. **Secrets**: real OAuth client ids, email provider (magic links), PSP for
   Pro checkout, `GEMINI_API_KEY` for painted art.
3. **DNS/branding flip**: point the Codply domain at this Django app.
4. **Data migration**: none planned — Codply's data stays; this platform
   starts fresh (confirm with stakeholders before flip).
5. **Retire Codply**: freeze its repo, archive the deployment, keep the
   read-only reference copy for a quarter.

## 4. Remaining documented differences (all minor)

The first pass's "deliberate non-goals" have all shipped (see §0). What
remains intentionally different:

- **Draft view granularity**: draft files appear when codegen finishes (one
  snapshot per stage), not token-by-token — our engine doesn't stream LLM
  output mid-node.
- **Server-side screenshot render**: `POST /games/{id}/screenshot` is a 404
  stub (no headless browser); the composer's in-frame capture path works and
  the client falls back gracefully — identical UX to a reference deployment
  whose capture worker is down.
- **Cover source**: covers come from the game's painted background rather
  than a captured gameplay frame (same slot, different art source).
- **Remix mechanics**: remixes re-generate from the source prompt (+ first
  change) instead of cloning the source bundle server-side — same UX,
  slower first paint, counts/lineage identical.
- **OAuth**: routes + screens exist; providers stay disabled until client
  ids are configured (`/auth/oauth/*/start` → generic login error, exactly
  like a reference deployment with no providers configured).
