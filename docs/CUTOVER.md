# P5 — Parity QA & Codply Cutover Plan

Status date: 2026-07-16 (branch `feat/codply-migration`).

Goal restated: a visitor believes they are using Codply; under the hood the
platform is our Django web tier + our FastAPI generation engine. This document
is the parity scorecard against Codply and the checklist to retire it.

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
| **Clarifying questions** (pause → one-tap answers → resume, Surprise me) | ✅ | ✅ engine `awaiting_input` + `/answers`; React ClarifyCards |
| Agent transcript (activity/file/message rows) | ✅ (real tool events) | 🟡 synthesized: step + `heal` retry narration; island already renders the full vocabulary (`activity`/`file`/`message`) if the engine emits more later |
| Stop / cancel | ✅ | ✅ engine `/cancel`, island Stop button |
| Chat edits (per-game mutex, in-place) | ✅ | ✅ tweak pipeline + one-active-job guard |
| **Immutable versions + version tree + rollback** | ✅ | ✅ engine `games/{id}/v{n}` bundles, versions/source/rollback APIs, island VersionTree |
| Code view (CodeMirror, file tabs) | ✅ editable index.html w/ lint gate | 🟡 read-only viewer (index.html / game.js / game.css); direct source editing is not in our engine's contract — edits go through chat |
| Live draft code view while generating | ✅ | ⬜ our pipeline emits one bundle at the end; revisit if the engine streams files |
| Console pane | ✅ console forwarding | 🟡 bridge events (`game_ready`/`game_over`/`game_error`); template SDK doesn't forward `console.*` |
| Screenshot-to-chat, image attachments | ✅ | ⬜ engine prompt contract is text-only today |

### Player & feed
| Sandboxed player (foreign origin + `sandbox="allow-scripts"`) | ✅ | ✅ identical double isolation |
| Ready watchdog, reload card, fullscreen | ✅ | ✅ React GamePlayer |
| **TikTok-style vertical overlay feed** (swipe / arrows / rail, infinite paging, URL sync) | ✅ | ✅ overlay island over `/feed.json` |
| Feed (For You / New / Trending / Following, genre filter) | ✅ | ✅ |
| Game page SEO (OG, JSON-LD), share bar, copy link | ✅ | ✅ |
| Play-count ping | ✅ | ✅ server-side on game page views |

### Social
| Likes, saves, shares, threaded comments (+delete) | ✅ | ✅ |
| Follows + notifications + following feed | ✅ | ✅ |
| Remix (+ lineage, counts) | ✅ | ✅ |
| Search | ✅ (pg_trgm) | 🟡 LIKE-based on SQLite dev; pg_trgm when Postgres is enabled |

### Billing & dashboard
| Credit ledger, daily claim, quota gate | ✅ | ✅ |
| Pro checkout | ✅ (provider) | 🟡 fake-provider parity (swap in real PSP at launch) |
| Creator dashboard, settings | ✅ | ✅ |

### Platform
| Admin/CMS + moderation (reports, takedowns) | ✅ | ✅ Django admin |
| robots.txt, sitemap.xml, /status, legal pages | ✅ | ✅ |
| Engine quality: checkpointed retries, shared QA gate authority, ship-what-works | ✅ | ✅ our gate + best-effort salvage + `heal` narration |
| Cover art from gameplay frame | ✅ | ⬜ needs headless capture; covers optional in our cards |

---

## 2. Verification evidence

- **149 automated tests green**: 100 engine (incl. clarify pause/resume/cancel,
  immutable versions/rollback/source, restart semantics, seq continuity) +
  49 Django (incl. answers/cancel proxies, versions JSON, rollback pointer
  flip, feed.json, island props).
- **Live smoke** (all three dev servers): home + overlay island wiring,
  feed.json, static island bundles, signup/login, create → studio island
  props → live SSE `step` frames through the proxy → cancel; legacy-game
  version backfill verified against the real dev DB.
- **Real-generation smoke** (real LLM key): create → clarify → publish v1 →
  chat edit → v2 → both versions playable → rollback to v1 → public page.
  (`scratchpad/real_smoke.py`; see latest run log.)

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

## 4. Deliberate non-goals (documented differences)

- No direct source editing / lint-gated saves (chat edits are the editing
  model; our engine treats bundles as build outputs).
- No live draft file stream during generation.
- No in-frame screenshot/attachment pipeline.
These are additive engine features; the islands already speak the full SSE
vocabulary, so each can land later without web-tier rework.
