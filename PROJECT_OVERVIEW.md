# Project Overview

## 1. Project Overview

This project is an **AI-powered prompt-to-game platform**: a product that turns
a plain natural-language idea into a complete, playable game. A user types what
they want (in Arabic or English) — *"Make a Flappy Bird clone"*, *"لعبة تخمين
أرقام"* — and the platform generates a full, self-contained, bilingual browser
mini-game they can play, share, and keep editing in natural language.

The goal is to remove the gap between having a game idea and having a game.
There is no code, no engine, and no assets for the user to manage: they
describe, the platform builds, and they play. The experience is a single loop —
prompt → live generation progress → a playable game — with the ability to refine
it conversationally afterward (*"make it faster"*, *"أصعب"*).

## 2. Project Architecture

The system is a small monorepo of independent components with a single
direction of dependency:

- **Generation service** (`services/generation-service/`) — the engine and
  source of truth. A FastAPI service built on the Anthropic SDK that runs the
  whole pipeline: intake/scope check → blueprint → gameplay code → a blocking
  quality gate → packaging → storage. Exposes a REST API; has no UI.
- **Games CDN** (`services/games-cdn/`) — a dedicated static origin that serves
  the generated games (a stand-in for an S3 bucket + CDN).
- **Web client** (`apps/web-client/`) — a Django app that provides the UI. It
  validates the prompt with an LLM before dispatching, then talks to the
  generation service's REST API for everything else. Generated games render in
  a sandboxed, cross-origin iframe.
- **Starter template** (`packages/starter-template/`) — the versioned runtime
  contract every generated game inherits.

This section is only an introduction; see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
for the full design.

## 3. Reference Project

The repository contains a separate project named **Codply** in the [`codply/`](codply/)
directory.

**Codply is a reference project only.** It is **not** part of the main project
and must never be treated as such — do not build, ship, or modify it as part of
this codebase.

Its sole purpose is reference: use it to understand architecture, UI/UX,
workflows, features, implementation patterns, and overall behavior. The coding
agent should consult Codply whenever it needs inspiration or wants to see how a
feature is implemented, while keeping the main project fully independent.
