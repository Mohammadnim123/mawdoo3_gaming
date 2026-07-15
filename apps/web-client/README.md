# Web Client (Django)

The user-facing half of the Prompt-to-Game MVP: a deliberately lightweight
Django app that renders the UI and forwards every generation action to the
**generation service's REST API** — its only backend. There is no game
generation logic, no database, and no shared storage here. The one AI call
this app owns is the **pre-dispatch prompt validation**: before dispatching,
the backend sends the prompt to the LLM to verify the request is actually a
game and its complexity is within what the platform can deliver — invalid
prompts never become jobs.

```
browser ──▶ Django (this app, :8001) ──validate (LLM: a game? deliverable?)
                    │                     │ valid
                    │                     └──HTTP──▶ generation service (:8000)
                    └─▶ <iframe sandbox="allow-scripts"> loads the game
                        straight from the service's play origin (:8000/g/…)
```

## What it does

| Page | Route | Behaviour |
|------|-------|-----------|
| Home | `/` | Prompt input to generate a game + the list of generated games (bilingual cards) |
| Progress | `/generations/{job_id}/` | Live pipeline stage; polls a small JSON proxy (`/api/generations/{job_id}/`), redirects to the game when the job succeeds; `<noscript>` meta-refresh fallback |
| Play | `/games/{game_id}/` | The game in a sandboxed cross-origin iframe + an edit box ("make it faster", "أصعب") that submits a tweak job |

Language: `?lang=ar|en` toggles the chrome (RTL by default), persisted in a
plain cookie — no sessions, no database.

## Architecture notes

- [games/services/generation_api.py](games/services/generation_api.py) is the
  **single integration point** with the service. Views never call `requests`
  directly; templates never see service URLs except the ready-made `play_url`.
- [games/services/prompt_validation.py](games/services/prompt_validation.py)
  is the app's own LLM call (Anthropic SDK, forced tool-use verdict). It fails
  closed — no verdict, no dispatch — and length limits are checked locally
  before any LLM spend. The service's pipeline keeps its own authoritative
  scope check for prompts dispatched straight against its API.
- The client keeps **no state**. Games, jobs, and bundles live in the service;
  Django is stateless presentation (deployable/scalable independently).
- Generated games are **untrusted code**: they render only in an
  `<iframe sandbox="allow-scripts">` pointing at the service's origin —
  cross-origin + no `allow-same-origin` means the game cannot touch this
  app's DOM, cookies, or storage; its only channel out is `postMessage`.
- JavaScript is progressive enhancement only (status polling, game events);
  every flow works with plain form posts and redirects.

## Run it

```bash
# from the repo root
make setup-web       # venv + pip install + .env
make dev-web         # http://localhost:8001  (expects the service on :8000)

# tests (mocked API client — no live service needed)
make test-web
```

Configuration lives in [.env.example](.env.example) — most importantly
`GENERATION_API_URL` (the generation service) and `OPENROUTER_API_KEY`
(or `VALIDATION_AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`), which the
prompt-validation LLM call requires.
