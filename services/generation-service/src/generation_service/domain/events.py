"""Job progress events — the value objects behind the SSE stream.

A generation job emits an ordered sequence of events (``seq`` 1..N). They are
persisted (so a reconnecting client can replay from ``Last-Event-ID``) and
published on an in-process bus (so a connected client sees them live). The wire
event names mirror the Codply contract: ``step | progress | questions |
activity | heal | done | failed``.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class JobEvent:
    seq: int
    event: str
    data: dict
