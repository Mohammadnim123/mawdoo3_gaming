"""LLM prompt validation — the one AI call this client owns.

Before dispatching a generation, the backend sends the prompt to the LLM to
verify exactly two things: the request is actually a game, and its complexity
is within what the platform can deliver (a small browser mini-game). Invalid
prompts never become jobs — the user sees the language-matched reason
immediately.

Built on the Anthropic SDK like the generation service: one forced `emit`
tool call whose input schema IS the verdict, so the answer is structured at
the API boundary. The client keeps no database, so per-call token usage is
logged (not persisted) for cost visibility.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass

import anthropic
from django.conf import settings

logger = logging.getLogger(__name__)

VALIDATION_SYSTEM = """\
You are the intake validator for a prompt-to-game platform that turns natural-language
ideas (Arabic or English) into SMALL single-player browser mini-games built with plain
HTML/CSS/JS (canvas, DOM, or lightweight Three.js 3D).

Verify exactly two things about the user's request:
1. is_game — it is actually a game: something playable, not an article, essay, app,
   website, question, or general chat.
2. deliverable — its complexity is within what the platform can deliver: a small
   single-player browser mini-game.

IN SCOPE — examples: snake, flappy-bird style, memory cards, tic-tac-toe, pong, breakout,
runner games, space shooters, simple platformers, quiz games, clicker games, number/word
puzzles (e.g. لعبة تخمين أرقام, لعبة جمع العملات), logic/board games with an AI opponent,
and LIGHTWEIGHT 3D mini-games built from simple primitives (3D coin collector, rotating
cube puzzle, simple 3D runner or maze).

OUT OF SCOPE — always reject: multiplayer or online games, games needing heavy engines
(Unity/Unreal), AAA-style requests (PUBG, Fortnite, Minecraft, GTA), open-world or
photorealistic 3D, games needing external 3D models/textures/assets, anything that is not
a game, and anything needing a server or accounts.

Rules:
- A vague but game-like idea passes — never reject an idea for being underspecified.
- When either check fails, write reason as ONE short sentence the user could be shown,
  in the same language as their prompt (Arabic prompt → Arabic reason).
"""

_EMIT_TOOL_NAME = "emit"

_EMIT_TOOL = {
    "name": _EMIT_TOOL_NAME,
    "description": "Return the validation verdict.",
    "input_schema": {
        "type": "object",
        "properties": {
            "is_game": {
                "type": "boolean",
                "description": "The request is actually a game",
            },
            "deliverable": {
                "type": "boolean",
                "description": "Small single-player browser mini-game complexity",
            },
            "reason": {
                "type": "string",
                "description": "When either check fails: one short sentence in the "
                "user's language explaining the rejection",
            },
        },
        "required": ["is_game", "deliverable"],
    },
}

# Models occasionally nest the tool input under an envelope key (echoing the
# tool-call wire format) instead of emitting the fields at the top level.
_ENVELOPE_KEYS = ("parameters", "arguments", "input", "properties", _EMIT_TOOL_NAME)

# The verdict is three tiny fields; generous headroom, but never a long answer.
_MAX_OUTPUT_TOKENS = 300


class PromptValidationUnavailable(Exception):
    """The LLM could not be reached or did not produce a usable verdict."""


@dataclass(frozen=True)
class PromptVerdict:
    valid: bool
    reason: str | None = None


def validate_prompt(prompt: str) -> PromptVerdict:
    """One structured LLM call; the generate view branches on the result.

    Fails closed: any transport or shape problem raises
    PromptValidationUnavailable — nothing is dispatched on a missing verdict.
    """
    try:
        response = _get_client().messages.create(
            model=settings.VALIDATION_MODEL,
            system=VALIDATION_SYSTEM,
            messages=[{"role": "user", "content": f"User prompt:\n{prompt}"}],
            max_tokens=_MAX_OUTPUT_TOKENS,
            temperature=0.0,
            tools=[_EMIT_TOOL],
            tool_choice={"type": "tool", "name": _EMIT_TOOL_NAME},
        )
    except anthropic.AnthropicError as exc:
        logger.warning("prompt validation LLM call failed: %s", exc)
        raise PromptValidationUnavailable(str(exc)) from exc

    logger.info(
        "prompt validation: model=%s input_tokens=%d output_tokens=%d",
        settings.VALIDATION_MODEL,
        response.usage.input_tokens,
        response.usage.output_tokens,
    )

    block = next((b for b in response.content if b.type == "tool_use"), None)
    if block is None:
        raise PromptValidationUnavailable("the model returned no verdict")
    return _parse_verdict(block.input)


def _parse_verdict(payload: object) -> PromptVerdict:
    if not isinstance(payload, dict):
        raise PromptValidationUnavailable("the model returned a malformed verdict")
    if "is_game" not in payload:
        for key in _ENVELOPE_KEYS:
            inner = payload.get(key)
            if isinstance(inner, dict) and "is_game" in inner:
                payload = inner
                break
        else:
            raise PromptValidationUnavailable("the model returned a malformed verdict")
    valid = bool(payload.get("is_game")) and bool(payload.get("deliverable"))
    reason = None
    if not valid:
        reason = str(payload.get("reason") or "").strip() or None
    return PromptVerdict(valid=valid, reason=reason)


_client: anthropic.Anthropic | None = None
_client_lock = threading.Lock()


def _get_client() -> anthropic.Anthropic:
    """Lazy singleton, double-checked like generation_api.get_client —
    threaded WSGI servers must not race two clients into existence."""
    global _client
    if _client is None:
        with _client_lock:
            if _client is None:
                _client = _create_client()
    return _client


def _create_client() -> anthropic.Anthropic:
    """Both providers speak the Anthropic Messages API (mirrors the
    generation service's client factory)."""
    provider = settings.VALIDATION_AI_PROVIDER
    if provider == "anthropic":
        return anthropic.Anthropic(
            api_key=settings.ANTHROPIC_API_KEY or "not-configured",
            timeout=settings.VALIDATION_TIMEOUT_SECONDS,
        )
    if provider == "openrouter":
        # The SDK appends /v1/messages itself; the configured base URL is the
        # OpenAI-style one ending in /v1, so strip that suffix.
        base = settings.OPENROUTER_BASE_URL.rstrip("/").removesuffix("/v1")
        return anthropic.Anthropic(
            api_key=settings.OPENROUTER_API_KEY or "not-configured",
            base_url=base,
            timeout=settings.VALIDATION_TIMEOUT_SECONDS,
        )
    raise PromptValidationUnavailable(f"unknown AI provider: {provider!r}")
