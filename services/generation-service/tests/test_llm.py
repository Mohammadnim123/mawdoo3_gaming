"""StructuredLlm recovery behavior: envelope unwrapping and corrective retries."""

from __future__ import annotations

import pytest
from pydantic import BaseModel

from generation_service.infrastructure.ai.llm import StructuredLlm


class Artifact(BaseModel):
    name: str
    score: int


class FakeUsage:
    input_tokens = 10
    output_tokens = 20


class FakeToolBlock:
    type = "tool_use"

    def __init__(self, input: dict) -> None:
        self.id = "tool_1"
        self.input = input


class FakeResponse:
    def __init__(self, input: dict, stop_reason: str = "tool_use") -> None:
        self.content = [FakeToolBlock(input)]
        self.stop_reason = stop_reason
        self.usage = FakeUsage()

    def model_dump(self) -> dict:
        return {
            "content": [
                {"type": "tool_use", "id": b.id, "name": "emit", "input": b.input}
                for b in self.content
            ]
        }


class FakeMessages:
    def __init__(self, responses: list[FakeResponse]) -> None:
        self._responses = responses
        self.calls: list[dict] = []

    async def create(self, **kwargs) -> FakeResponse:
        self.calls.append(kwargs)
        return self._responses[len(self.calls) - 1]


class FakeClient:
    def __init__(self, responses: list[FakeResponse]) -> None:
        self.messages = FakeMessages(responses)


def make_llm(responses: list[FakeResponse]) -> tuple[StructuredLlm, FakeClient]:
    client = FakeClient(responses)
    return StructuredLlm(client, "test-model", 0.4, 1000), client


async def test_valid_payload_passes_first_try():
    llm, client = make_llm([FakeResponse({"name": "snake", "score": 3})])
    artifact, usage = await llm.generate("stage", "sys", "user", Artifact)
    assert artifact == Artifact(name="snake", score=3)
    assert usage.total_tokens == 30
    assert len(client.messages.calls) == 1


@pytest.mark.parametrize("envelope", ["parameters", "arguments", "input", "properties", "emit"])
async def test_envelope_wrapped_payload_is_unwrapped_without_retry(envelope):
    llm, client = make_llm([FakeResponse({envelope: {"name": "snake", "score": 3}})])
    artifact, _ = await llm.generate("stage", "sys", "user", Artifact)
    assert artifact == Artifact(name="snake", score=3)
    assert len(client.messages.calls) == 1


async def test_schema_name_wrapped_payload_is_unwrapped_without_retry():
    # Seen in production: the blueprint stage emitted {"blueprint": {...}}.
    llm, client = make_llm([FakeResponse({"artifact": {"name": "snake", "score": 3}})])
    artifact, _ = await llm.generate("stage", "sys", "user", Artifact)
    assert artifact == Artifact(name="snake", score=3)
    assert len(client.messages.calls) == 1


async def test_nested_envelope_wrap_is_unwrapped_without_retry():
    llm, client = make_llm(
        [FakeResponse({"emit": {"artifact": {"name": "snake", "score": 3}}})]
    )
    artifact, _ = await llm.generate("stage", "sys", "user", Artifact)
    assert artifact == Artifact(name="snake", score=3)
    assert len(client.messages.calls) == 1


async def test_multi_key_non_envelope_payload_still_retries():
    # A dict with several wrong keys is a genuinely bad payload, not an
    # envelope — it must go through the corrective-retry path.
    llm, client = make_llm(
        [
            FakeResponse({"name": {"en": "snake"}, "extra": True}),
            FakeResponse({"name": "snake", "score": 3}),
        ]
    )
    artifact, _ = await llm.generate("stage", "sys", "user", Artifact)
    assert artifact == Artifact(name="snake", score=3)
    assert len(client.messages.calls) == 2


async def test_invalid_payload_gets_corrective_retry():
    llm, client = make_llm(
        [
            FakeResponse({"wrong": True}),
            FakeResponse({"name": "snake", "score": 3}),
        ]
    )
    artifact, _ = await llm.generate("stage", "sys", "user", Artifact)
    assert artifact == Artifact(name="snake", score=3)
    assert len(client.messages.calls) == 2
    followup = client.messages.calls[1]["messages"][-1]["content"]
    assert followup[0]["type"] == "tool_result"
    assert followup[0]["is_error"] is True
    assert "failed schema validation" in followup[-1]["text"]


async def test_truncated_output_gets_compactness_correction():
    llm, client = make_llm(
        [
            FakeResponse({}, stop_reason="max_tokens"),
            FakeResponse({"name": "snake", "score": 3}),
        ]
    )
    artifact, _ = await llm.generate("stage", "sys", "user", Artifact)
    assert artifact == Artifact(name="snake", score=3)
    followup = client.messages.calls[1]["messages"][-1]["content"]
    assert "cut off by the output-token limit" in followup[-1]["text"]


async def test_three_failures_raise_with_detail():
    llm, _ = make_llm([FakeResponse({}) for _ in range(3)])
    with pytest.raises(RuntimeError, match="did not produce a valid Artifact"):
        await llm.generate("stage", "sys", "user", Artifact)
