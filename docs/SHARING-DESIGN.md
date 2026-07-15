# Sharing Feature — Design & Implementation Plan

**Status:** v1.0 proposal (2026-07-13) · not yet implemented
**Scope decision:** share links were an explicit MVP deferral (`FEATURE_SHARE_LINKS=false`).
This document pulls them into scope by owner request and is the blueprint for the build.
**Governing constraints carried over:** untrusted generated code stays sandboxed ·
bilingual/RTL is a launch gate · WhatsApp-first regional audience · recipient plays
instantly, no account, no install · cost/abuse bounded from day one.

---

## 1. Review of the current implementation

There is no sharing *feature* today — there is a raw play URL. What exists, and why
each piece is not shareable in production form:

| # | Current state | Problem |
|---|---|---|
| R1 | The "share URL" is the internal play path `GET /g/{game_id}/index.html` | It is the **storage identity**, not a share grant: it cannot be revoked, expired, rotated, or counted. Once sent, it is public forever. |
| R2 | `game_id = uuid4().hex[:12]` — 48 bits | Guessable at scale; too weak to serve as an unlisted-content capability token. |
| R3 | `GET /api/v1/games` is public and lists **every** game | Total enumeration: every game is effectively public regardless of URL secrecy. Fine for a local dev tool; fatal for real sharing ("unlisted" must actually mean unlisted). |
| R4 | Game pages have `<title>` only — no OpenGraph/Twitter meta, no thumbnail | Links pasted into WhatsApp/iMessage/X render as bare URLs. For a WhatsApp-first product, the rich preview *is* the invitation — this is the single biggest UX gap. |
| R5 | No share UI — the user copies the browser address bar | The client URL (`/games/{id}/` on the Django web client) isn't even the game URL; there is no copy button, no WhatsApp intent, no native share sheet. |
| R6 | The recipient lands on the bare game iframe content | No wrapper: no title, no "play" framing, no attribution, no "create your own" loop — the growth mechanism the product thesis depends on. |
| R7 | Template `postMessage` hooks (`sdk.report`, `sdk.gameOver`) exist but nothing consumes them for sharing | The "share your score" moment — the highest-intent share trigger — is wired on the game side and dropped on the floor. |
| R8 | No play/share counting | The go/no-go metric of the whole MVP is "do people share and come back" — currently unmeasurable. |
| R9 | Nothing between "gate passed" and "publicly reachable" | The quality gate checks correctness, not content appropriateness. Fine while the only audience is the creator; not fine once links go to third parties. |

**Design conclusion:** the root defect is conceptual — the play URL conflates *storage
identity* with *access grant*. The redesign introduces a first-class `Share` resource
that separates them.

---

## 2. Goals & non-goals

**Goals**
1. One tap from "I made this" to a WhatsApp message with a rich preview card.
2. Recipient: tap → branded landing page → game playing in under 2 seconds, no account.
3. Shares are revocable, optionally expiring, and counted (plays, referrers-lite).
4. Internal identifiers never leak; unlisted means unreachable without the token.
5. Same sandbox guarantees for recipients as for creators (C2 unchanged).
6. Forward-compatible with accounts (`created_by` slot), CDN serving, and moderation.

**Non-goals (this iteration)**
Feed/discovery · remix from a share · per-recipient links · dynamic per-score OG images ·
third-party URL shorteners (own short domain instead) · embedding on external sites.

---

## 3. Architecture

### 3.1 Concept model

```
Game (internal)  1 ──── n  Share (public capability)
  id: internal storage key    token: 128-bit base62, unguessable
  never shown to recipients   status: active | revoked
                              expires_at, play counters, created_by (future owner)
```

A share is a **capability token**: possession grants play access while the share is
active. Multiple shares per game are allowed (revoke the link you sent to group A
without killing group B's). "Regenerate link" = revoke + mint.

### 3.2 Request topology

```
Creator (client)                     Recipient (WhatsApp tap)
   │ POST /api/v1/games/{id}/shares      │
   │  → { share_url }                    ▼
   │                              GET /s/{token}            ← server-rendered landing page
   │                                │  (OG meta, RTL, CTA)     404/410 if unknown/revoked
   │                                ▼
   │                              <iframe sandbox="allow-scripts"
   │                                      src="/s/{token}/g/index.html">
   │                                ▼
   │                              GET /s/{token}/g/{path}   ← bundle streamed via the
   │                                                          share token, share status
   │                                                          checked per request
```

**Key decision — token-path asset serving:** recipients load the bundle through
`/s/{token}/g/{path}`, not `/g/{game_id}/…`. Three wins:
- The internal `game_id` never appears anywhere a recipient can see.
- Revocation is **instant and complete** (every asset request re-checks status; a
  cached-in-memory token→(game, status) entry with a short TTL keeps this cheap).
- The existing `/g/` route can later be locked to the authenticated creator UI.

Trade-off: CDN caching keys per token rather than per game. Acceptable at this scale;
the production path (§8, Phase 3) moves the status check to the edge (Worker + KV)
so the CDN cache stays per-token but revocation propagates in seconds.

### 3.3 Where it lives

All server pieces go in the existing generation service (FastAPI) as a new vertical:
`domain/sharing.py` (entities) · `infrastructure/persistence` (repo) ·
`application/use_cases/shares.py` · `api/routes/shares.py` + `api/routes/share_page.py`
(landing page, Jinja2 via `starlette.templating`). No new deployment. The share page
is deliberately server-rendered — WhatsApp's link-preview crawler does not execute
JavaScript, so OG tags must be in the HTML response.

---

## 4. Data model

```sql
CREATE TABLE shares (
    token          TEXT PRIMARY KEY,          -- 22-char base62 (~131 bits), secrets.token_urlsafe-derived
    game_id        TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'active',   -- active | revoked
    created_at     TEXT NOT NULL,
    revoked_at     TEXT,
    expires_at     TEXT,                      -- NULL = never
    play_count     INTEGER NOT NULL DEFAULT 0,
    last_played_at TEXT,
    created_by     TEXT                       -- future owner_id (plain UUID, no FK — ADR-0022 rule)
);
CREATE INDEX idx_shares_game_id ON shares (game_id);
```

Also new: `share_events` **(bare-minimum analytics, aggregate only, no PII)**:

```sql
CREATE TABLE share_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    token      TEXT NOT NULL,
    event      TEXT NOT NULL,      -- page_view | play_start | game_over
    locale     TEXT,               -- ar | en
    created_at TEXT NOT NULL
);
```

No IP addresses, no user agents, no cookies on the share page. `play_count` is the
denormalized fast counter; `share_events` is the audit series behind the go/no-go metrics.

---

## 5. Backend API (FastAPI)

Management endpoints (consumed by the Django web client; later gated by auth):

```
POST   /api/v1/games/{game_id}/shares
  body: { "expires_in_days": 30 | null }
  201 → { "token", "share_url", "status": "active", "expires_at", "created_at" }
  409 if the game doesn't exist / isn't gate-approved

GET    /api/v1/games/{game_id}/shares
  200 → { "items": [ShareResponse], "total" }

POST   /api/v1/shares/{token}/revoke
  200 → ShareResponse (status: revoked)      -- POST, not DELETE: it's a state change, kept auditable

POST   /api/v1/shares/{token}/regenerate
  201 → new ShareResponse (old one revoked atomically)
```

Public endpoints (recipient path — rate-limited, no auth ever):

```
GET    /s/{token}                 → HTML landing page (OG meta, hreflang, CTA)
                                    404 unknown · 410 revoked/expired (distinct page: "this game is no longer shared")
GET    /s/{token}/g/{path}        → bundle asset stream (status-checked, CSP + nosniff, Cache-Control: private-ish short TTL)
GET    /api/v1/shares/{token}     → public JSON metadata (title ar/en, genre, locale) — used by the landing page's client bits and future embeds
POST   /api/v1/shares/{token}/events
  body: { "event": "play_start" | "game_over", "locale": "ar" }
  204 · fire-and-forget from the page; heavily rate-limited; invalid events dropped silently
```

Error envelope stays the existing `{"error": {"code", "message"}}`. New codes:
`share_not_found`, `share_revoked`, `share_expired`.

**Token generation:** `secrets.token_bytes(16)` → base62 (22 chars). 128 bits makes
brute force and enumeration statistically irrelevant; tokens are single-purpose
capabilities, so no signing/JWT machinery is needed — the DB row is the truth.

### Closing the enumeration hole (R2/R3)

Shipping shares without fixing enumeration would be theater:
- `GET /api/v1/games` moves behind a config flag (`PUBLIC_GAMES_LIST=true` stays on
  for the local web client, documented as dev-only; off in any deployed env —
  replaced by the authenticated "my games" endpoint when accounts land).
- New `game_id`s upgrade from `uuid4().hex[:12]` to the full 32-hex uuid (122 bits).
  IDs become defense-in-depth, not the security boundary — the share token is.

---

## 6. The share landing page (`/s/{token}`)

The product surface that makes the WhatsApp message look like an invitation:

- **Rich preview (server-rendered):** `og:title` (localized game title), `og:description`
  (game summary), `og:image` (cover card, below), `og:locale` ar/en + alternate,
  `twitter:card=summary_large_image`. This is why the page is Jinja2-rendered HTML,
  not the SPA.
- **Cover card (`og:image`):** generated at package time as `cover.png` in the bundle —
  a 1200×630 card rendered from the blueprint (title in both scripts, genre glyph,
  visual-style colors) via SVG → PNG (`resvg`/`cairosvg`; no headless browser).
  When the Phase-3 gate adds a Playwright smoke-boot, its screenshot replaces the
  generated card for free.
- **Layout:** full-bleed game iframe with a slim header (title, language toggle) and a
  footer CTA — "صُنعت بالذكاء الاصطناعي — اصنع لعبتك ✨ / Made with AI — create your own" →
  links to the creation surface. This footer is the viral loop; it is a feature, not chrome.
- **Locale pick order:** `?lang` → `Accept-Language` → share's `default_locale`. Full
  RTL, same bilingual font stack as the template.
- **Score moment (uses R7's dangling hook):** the page listens for the template's
  `game_over` postMessage and swaps the footer CTA to "تحدَّ أصدقاءك — أرسل اللعبة!"
  with the share re-share button — sharing peaks at the end of a round, so that is
  when the button appears.

---

## 7. Client UX (creator side)

- **Share button** on the player view and on each card (`⤴ مشاركة / Share`). First tap
  lazily creates the share (POST) and opens a share sheet:
  1. **Native share** via `navigator.share({title, url})` when available (mobile —
     lands directly in the OS sheet with WhatsApp first; this is the primary path),
  2. **WhatsApp intent** `https://wa.me/?text={title}%20{url}` as an explicit button
     (desktop and fallback),
  3. **Copy link** with clipboard API + "تم النسخ ✓" feedback,
  4. **QR code** (tiny client-side generator) for cross-device handoff.
- Repeat taps reuse the existing active share; a small "إعادة إنشاء الرابط / regenerate
  link" action revokes and re-mints for the "I shared it to the wrong group" moment.
- Message template is pre-localized: `جرّب لعبتي: {title_ar} 🎮 {url}`.

---

## 8. External services & integrations

| Concern | Recommendation | Why / why not alternatives |
|---|---|---|
| WhatsApp | `wa.me` intent + OG tags only | No API/business account needed; the crawler reads OG. |
| Native share sheet | Web Share API | Free, first-party, best mobile UX. |
| Short links | **Own short domain** (e.g. `m3g.app/s/{token}`) — config `SHARE_BASE_URL` | Third-party shorteners add link rot, tracking, and a trust hop; tokens are already short. |
| OG thumbnails | In-house SVG→PNG at package time; Playwright screenshot when Phase-3 gate lands | No per-share cost, no external renderer. |
| QR codes | Client-side lib (~2 KB) | No service needed. |
| CDN / edge | Cloudflare (R2 + Workers + KV) or CloudFront + Lambda@Edge — **Phase 3** | Worker checks token status in KV at the edge (revocation propagates in seconds) and serves bundle assets from cache; aligns with the existing StoragePort/CDN migration plan and the region decision. |
| Rate limiting | `slowapi` in-process now; Redis backend later (`REDIS_URL` already reserved) | Public endpoints need it before any real link circulates. |
| Analytics | First-party `share_events` only | The MVP spec caps analytics at the bare minimum; Plausible/PostHog is a later, separate decision. |
| Moderation | Add a cheap moderation pass (Haiku-tier classify of blueprint strings + prompt) as a **precondition of share creation**, cached per game | Closes R9: gate = correctness, moderation = appropriateness. Only runs once per game, only when sharing. |

---

## 9. End-to-end flow (final)

```
CREATE   creator taps Share → POST /games/{id}/shares (moderation check on first share)
         → { share_url } → native sheet / wa.me / copy / QR
INVITE   WhatsApp renders rich card from /s/{token} OG tags (crawler gets 200 + meta, no JS)
OPEN     recipient taps → GET /s/{token}
         · active → landing page, records page_view
         · revoked/expired → localized 410 page ("no longer shared") + "create your own" CTA
PLAY     iframe sandbox="allow-scripts" → /s/{token}/g/index.html → assets stream through
         token path, per-request status check (cached ~30s) → play_start event
FINISH   game calls sdk.gameOver → postMessage → page shows score + re-share CTA → game_over event
MANAGE   creator: list shares, play counts, revoke, regenerate
MEASURE  share_events + play_count feed the go/no-go dashboard queries
```

---

## 10. Security considerations

1. **Capability tokens:** 128-bit random, generated with `secrets`; never derived from
   game data; single lookup by primary key. Revocation is a DB state flip enforced on
   every asset request (with a short-TTL cache — bounded staleness ≤30 s).
2. **Sandbox unchanged (C2):** recipient iframe is `sandbox="allow-scripts"` with no
   `allow-same-origin`, `referrerpolicy="no-referrer"`, `allow=""`. Bundle responses
   keep the existing CSP (`connect-src 'none'`, self-only) + `X-Content-Type-Options`.
3. **Landing-page CSP + clickjacking:** the share page sets its own strict CSP
   (`frame-src` limited to the token play path, `frame-ancestors 'none'`, no inline JS
   beyond a nonce'd bootstrap) so the wrapper cannot be framed or injected.
4. **Enumeration closed:** public list endpoint off outside dev; full-width game ids;
   internal ids never in recipient-visible URLs (token-path serving).
5. **Rate limiting:** share creation (per client), `/s/{token}` resolution and events
   (per token + global) — prevents token-scanning and event-spam skewing metrics.
6. **Abuse & content:** moderation precondition before first share (R9); a
   `?report=1` affordance on the landing page files a report row → share can be
   force-revoked (admin action; endpoint exists, UI later).
7. **Privacy:** no cookies, no IP/User-Agent storage on the public path, aggregate-only
   events; no PII anywhere in the URL. Aligns with the regional data-residency stance.
8. **Transport:** HTTPS-only + HSTS in any deployed environment; no redirect
   parameters anywhere on the public surface (no open-redirect class).
9. **Future auth seam:** management endpoints already take the future `owner_id` via
   the existing deps layer; when accounts land, share management becomes owner-only
   with zero contract change.

---

## 11. Implementation phases

**Phase 1 — the working feature (≈1–2 days)**
Shares table + repository · create/revoke/regenerate/resolve use cases · management +
public APIs · Jinja2 landing page with OG tags (text-only card first) · token-path
asset serving · client share sheet (native/wa.me/copy) · play counting · flag
`FEATURE_SHARE_LINKS=true` · tests (token gen, revocation semantics, 404/410, OG tags
present, asset path checks status, rate limit).

**Phase 2 — the polished invitation (≈1–2 days)**
Cover-card SVG→PNG in the packaging step (`cover.png` in bundle) · score-moment
re-share CTA via postMessage · QR code · localized 410/expiry pages · regenerate UX ·
`Accept-Language` negotiation · share metrics in the games API (`play_count` on cards).

**Phase 3 — production hardening (with the cloud move)**
Short domain + `SHARE_BASE_URL` · edge serving (Worker + KV status check, CDN-cached
bundles, purge-on-revoke) · Redis rate limiting · moderation precondition wired to a
real classifier call · abuse-report handling · owner-scoped management under accounts ·
dashboard queries over `share_events`.

Each phase is independently shippable; Phase 1 alone already fixes R1–R8's worst cases
except thumbnails (R4 is half-fixed: OG text renders, image lands in Phase 2).

---

## 12. Testing plan

- **Unit:** token entropy/format · expiry math · revocation state machine ·
  moderation-precondition gating · event validation.
- **Integration (TestClient):** create→resolve→play-asset happy path · revoked → 410
  on page *and* assets · unknown → 404 · OG tags present and localized · internal id
  absent from every recipient-visible byte · rate-limit returns 429.
- **Manual/E2E:** paste link into WhatsApp (web) and verify the preview card · full
  recipient flow on a phone on the LAN · revoke while a recipient is mid-game
  (assets stop within cache TTL; the running game keeps playing — document as accepted).

---

## 13. Open questions (owner decisions, not blockers)

1. **Share TTL default** — never-expire vs 90-day default (recommend: never, with
   optional expiry; revocation covers the real need).
2. **Running-game semantics on revoke** — kill mid-session (would require a heartbeat)
   or let the loaded session finish (recommended; assets already stop).
3. **Moderation strictness** — block-on-flag vs flag-for-review at MVP scale
   (recommend block-on-flag; volume is tiny).
4. **Short domain** — needs a purchase/decision before Phase 3; `SHARE_BASE_URL`
   keeps it a config swap.
