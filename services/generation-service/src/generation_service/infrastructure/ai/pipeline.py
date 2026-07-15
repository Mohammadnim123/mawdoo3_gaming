"""The generation pipeline — a plain async orchestrator over the nodes.

    CREATE: understand ──(out of scope)──▶ END
                │
                ▼
            blueprint ─────────┐
    TWEAK:  revise_blueprint ──┤
                               ▼
              generate_code ──▶ validate ──(pass)──▶ package ──▶ store ──▶ END
                    ▲               │                  ▲
                    └──(retry ≤ N)──┤                  │(best attempt)
                                    └──(exhausted)──▶ salvage ──▶ END
                                                    (nothing shippable)

Tweak jobs rebuild an existing game: entry skips intake (the game is already
in scope) and revises the stored blueprint instead of designing from a
prompt. Both paths share code generation and the gate — a tweak whose every
attempt is unshippable (blocking failures) never overwrites the working game.

The control flow is deliberately explicit Python (a loop and two branches),
streamed stage-by-stage: `astream` yields (node_name, state_update) after
each node so the job runner can persist live progress exactly as before.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from generation_service.domain.entities import JobKind
from generation_service.infrastructure.ai.nodes import GenerationNodes
from generation_service.infrastructure.ai.state import GenerationState


class GenerationPipeline:
    def __init__(
        self, nodes: GenerationNodes, max_code_retries: int, deep_review_enabled: bool = False
    ) -> None:
        self._nodes = nodes
        self._max_code_retries = max_code_retries
        self._deep_review_enabled = deep_review_enabled

    async def astream(
        self, state: GenerationState
    ) -> AsyncIterator[tuple[str, dict]]:
        """Yield (node_name, state_update) as each stage completes."""
        s: GenerationState = dict(state)  # type: ignore[assignment]

        async def run(name: str, node) -> dict:
            update = await node(s)
            s.update(update)
            return update

        # Entry: intake for new games, blueprint revision for tweaks.
        if s.get("mode") == JobKind.TWEAK:
            yield "revise_blueprint", await run("revise_blueprint", self._nodes.revise_blueprint)
        else:
            yield "understand", await run("understand", self._nodes.understand)
            if s.get("failure"):
                return  # out of scope — terminal
            yield "blueprint", await run("blueprint", self._nodes.design_blueprint)

        # Code → gate loop with capped retries; the gate report feeds back
        # into the next attempt as actionable failure feedback. When retries
        # run out, salvage publishes the best shippable attempt (advisory
        # failures only) — a terminal failure needs every attempt to be
        # unsafe or unrunnable.
        while True:
            yield "generate_code", await run("generate_code", self._nodes.generate_code)
            yield "validate", await run("validate", self._nodes.validate)
            if s["gate_report"].passed and self._deep_review_enabled:
                yield "deep_review", await run("deep_review", self._nodes.deep_review)
            if s["gate_report"].passed:
                break
            if s.get("code_attempts", 0) <= self._max_code_retries:
                continue
            yield "salvage", await run("salvage", self._nodes.salvage_best_effort)
            if s.get("failure"):
                return
            break

        yield "package", await run("package", self._nodes.package)
        yield "store", await run("store", self._nodes.store)
