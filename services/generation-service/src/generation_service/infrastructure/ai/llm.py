"""LLM access — built on the Anthropic SDK.

One async client, two ways to reach Claude:
- `anthropic`  — the Anthropic API directly (ANTHROPIC_API_KEY).
- `openrouter` — OpenRouter's Anthropic-compatible endpoint (same SDK, same
  request shape, OPENROUTER_API_KEY) — one key, many Claude models.

Structured output is enforced with tool use: every stage call forces the
model to invoke a single `emit` tool whose input schema IS the Pydantic
model of the artifact (blueprint, code, analysis, verdict) — so every
artifact is schema-validated at the API boundary, with one corrective
retry on validation failure.
"""

from __future__ import annotations

import logging
from typing import TypeVar

from anthropic import AsyncAnthropic
from pydantic import BaseModel, ValidationError

from generation_service.config.settings import AISettings
from generation_service.domain.entities import LlmUsage

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

_EMIT_TOOL_NAME = "emit"

# Models occasionally nest the tool input under an envelope key (echoing the
# tool-call wire format) instead of emitting the fields at the top level.
_ENVELOPE_KEYS = ("parameters", "arguments", "input", "properties", _EMIT_TOOL_NAME)

# How many nesting levels _validate probes when unwrapping envelopes.
_MAX_UNWRAP_DEPTH = 3


def create_client(settings: AISettings) -> AsyncAnthropic:
    """The composition root calls this once; both providers speak the
    Anthropic Messages API."""
    if settings.ai_provider == "anthropic":
        return AsyncAnthropic(
            api_key=settings.anthropic_api_key or "not-configured",
            timeout=settings.llm_timeout_seconds,
            max_retries=settings.llm_max_retries,
        )
    if settings.ai_provider == "openrouter":
        # The SDK appends /v1/messages itself; the configured base URL is the
        # OpenAI-style one ending in /v1, so strip that suffix.
        base = settings.openrouter_base_url.rstrip("/")
        base = base.removesuffix("/v1")
        return AsyncAnthropic(
            api_key=settings.openrouter_api_key or "not-configured",
            base_url=base,
            timeout=settings.llm_timeout_seconds,
            max_retries=settings.llm_max_retries,
        )
    raise ValueError(f"unknown AI provider: {settings.ai_provider!r}")


class StructuredLlm:
    """One model bound to schema-validated structured calls."""

    def __init__(
        self,
        client: AsyncAnthropic,
        model: str,
        temperature: float,
        max_output_tokens: int,
    ) -> None:
        self.model = model
        self._client = client
        self._temperature = temperature
        self._max_output_tokens = max_output_tokens

    async def generate(
        self, stage: str, system: str, user: str, schema: type[T]
    ) -> tuple[T, LlmUsage]:
        """One structured call; returns the validated artifact + token usage.

        A schema-validation failure is fed back to the model up to twice —
        the third failure propagates (the job runner maps it to pipeline_error).
        """
        usage = LlmUsage(stage=stage, model=self.model)
        messages: list[dict] = [{"role": "user", "content": user}]
        tool = {
            "name": _EMIT_TOOL_NAME,
            "description": "Return the complete structured result.",
            "input_schema": schema.model_json_schema(),
        }

        # cache_control on the system block caches the static prefix (tools +
        # system prompt) across calls and retries — the code stage's system
        # prompt embeds the full template contract, so this is the bulk of the
        # input cost on every attempt.
        system_blocks = [
            {"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}
        ]

        last_error: ValidationError | None = None
        for _attempt in range(3):
            response = await self._client.messages.create(
                model=self.model,
                system=system_blocks,
                messages=messages,
                max_tokens=self._max_output_tokens,
                temperature=self._temperature,
                tools=[tool],
                tool_choice={"type": "tool", "name": _EMIT_TOOL_NAME},
            )
            usage.input_tokens += response.usage.input_tokens
            usage.output_tokens += response.usage.output_tokens
            usage.total_tokens = usage.input_tokens + usage.output_tokens

            block = next((b for b in response.content if b.type == "tool_use"), None)
            if block is None:
                messages = self._corrective_turn(
                    messages, response, "You must call the emit tool with the result."
                )
                continue
            try:
                return self._validate(stage, schema, block.input), usage
            except ValidationError as exc:
                last_error = exc
                truncated = response.stop_reason == "max_tokens"
                logger.warning(
                    "structured output failed validation at %s (stop_reason=%s): %s",
                    stage,
                    response.stop_reason,
                    exc,
                )
                if truncated:
                    correction = (
                        "Your emit call was cut off by the output-token limit, so the "
                        "result arrived incomplete. Emit the complete result again, "
                        "more compactly (no comments, no unnecessary whitespace)."
                    )
                else:
                    correction = (
                        "The emitted result failed schema validation. Fix every issue "
                        f"and emit the complete result again:\n{exc}"
                    )
                messages = self._corrective_turn(messages, response, correction)

        detail = ""
        if last_error is not None:
            issues = "; ".join(
                f"{'.'.join(str(p) for p in err['loc'])}: {err['msg']}"
                for err in last_error.errors()[:5]
            )
            detail = f" ({issues})"
        raise RuntimeError(
            f"stage {stage!r} did not produce a valid {schema.__name__}{detail}"
        ) from last_error

    @staticmethod
    def _validate(stage: str, schema: type[T], payload: object) -> T:
        """Validate the tool input, accepting an envelope-wrapped payload.

        Besides the known envelope keys, models sometimes wrap the fields
        under the artifact's own name (e.g. {"blueprint": {...}}) — any
        single-key dict whose value is a dict is probed, a few levels deep.
        Raises the ORIGINAL top-level ValidationError when unwrapping doesn't
        rescue the payload, so corrective feedback describes the real shape.
        """
        try:
            return schema.model_validate(payload)
        except ValidationError:
            for key_path, inner in StructuredLlm._envelope_candidates(
                payload, _MAX_UNWRAP_DEPTH
            ):
                try:
                    result = schema.model_validate(inner)
                except ValidationError:
                    continue
                logger.info(
                    "structured output at %s arrived wrapped in %r; unwrapped",
                    stage,
                    key_path,
                )
                return result
            raise

    @staticmethod
    def _envelope_candidates(payload: object, depth: int):
        """Yield (key_path, inner) for every plausible envelope nesting."""
        if depth <= 0 or not isinstance(payload, dict):
            return
        candidates = [
            (key, inner)
            for key in _ENVELOPE_KEYS
            if isinstance(inner := payload.get(key), dict)
        ]
        if len(payload) == 1:
            key, inner = next(iter(payload.items()))
            if isinstance(inner, dict) and key not in _ENVELOPE_KEYS:
                candidates.append((key, inner))
        for key, inner in candidates:
            yield key, inner
            for path, deeper in StructuredLlm._envelope_candidates(inner, depth - 1):
                yield f"{key}.{path}", deeper

    @staticmethod
    def _corrective_turn(messages: list[dict], response, correction: str) -> list[dict]:
        """Append the model's turn + a corrective user turn (tool_use blocks
        need a tool_result answer before the conversation can continue)."""
        assistant_content = response.model_dump()["content"]
        if not assistant_content:
            # The API rejects an empty mid-list assistant message with a 400;
            # substitute a placeholder so the corrective retry can proceed.
            assistant_content = [{"type": "text", "text": "(empty response)"}]
        followup: list[dict] = [
            {
                "type": "tool_result",
                "tool_use_id": block["id"],
                "content": "rejected: see correction below",
                "is_error": True,
            }
            for block in assistant_content
            if block.get("type") == "tool_use"
        ]
        followup.append({"type": "text", "text": correction})
        return [
            *messages,
            {"role": "assistant", "content": assistant_content},
            {"role": "user", "content": followup},
        ]
