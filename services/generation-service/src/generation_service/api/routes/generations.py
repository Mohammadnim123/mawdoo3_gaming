from __future__ import annotations

import asyncio
import json
from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import StreamingResponse

from generation_service.api.deps import get_container
from generation_service.api.schemas import (
    AnswersRequest,
    GenerationCreateRequest,
    GenerationResponse,
)
from generation_service.container import Container
from generation_service.domain.entities import JobStatus
from generation_service.domain.events import JobEvent

router = APIRouter(prefix="/api/v1/generations", tags=["generations"])

# Only genuinely-final events close the stream. The clarify pause ('questions')
# keeps it open on heartbeats: answers arrive over plain HTTP and the resumed
# run's events flow down the same connection.
_TERMINAL_EVENTS = {"done", "failed"}
_HEARTBEAT_SECONDS = 5.0


def _sse_frame(event: JobEvent) -> str:
    return f"id: {event.seq}\nevent: {event.event}\ndata: {json.dumps(event.data)}\n\n"


@router.post("", status_code=status.HTTP_202_ACCEPTED, response_model=GenerationResponse)
async def start_generation(
    body: GenerationCreateRequest,
    container: Annotated[Container, Depends(get_container)],
) -> GenerationResponse:
    """Accept a prompt and start an async generation job. Poll GET /{id} for progress."""
    job = await container.start_generation.execute(
        body.prompt, body.locale, skip_clarify=body.options.skip_questions
    )
    return GenerationResponse.from_entity(job)


@router.post("/{job_id}/answers", response_model=GenerationResponse)
async def answer_questions(
    job_id: str,
    body: AnswersRequest,
    container: Annotated[Container, Depends(get_container)],
) -> GenerationResponse:
    """Answer a paused job's clarifying questions and resume it. An empty
    answers object accepts every default ('Surprise me'). 409 unless the job
    is awaiting input."""
    job = await container.answer_questions.execute(job_id, body.answers)
    return GenerationResponse.from_entity(job)


@router.post("/{job_id}/cancel", response_model=GenerationResponse)
async def cancel_generation(
    job_id: str,
    container: Annotated[Container, Depends(get_container)],
) -> GenerationResponse:
    """Stop an in-flight generation. 409 once it already finished."""
    job = await container.cancel_generation.execute(job_id)
    return GenerationResponse.from_entity(job)


@router.get("/{job_id}", response_model=GenerationResponse)
async def get_generation(
    job_id: str,
    container: Annotated[Container, Depends(get_container)],
) -> GenerationResponse:
    job = await container.get_generation.execute(job_id)
    return GenerationResponse.from_entity(job)


@router.get("/{job_id}/stream")
async def stream_generation(
    job_id: str,
    request: Request,
    container: Annotated[Container, Depends(get_container)],
) -> StreamingResponse:
    """Server-Sent Events for live generation progress.

    Subscribes first (so no event produced mid-setup is lost), replays the
    persisted log after ``Last-Event-ID``, then relays live events until a
    terminal one. Reconnects resume losslessly from the header.

    A job can be terminal WITHOUT a terminal event in the log (failed by the
    restart sweep, or the failure emit itself failed) — for those, a terminal
    frame is synthesized from the job row so no client waits forever.
    """
    # 404 (via the error handler) if the job doesn't exist — before we stream.
    job = await container.get_generation.execute(job_id)

    bus = container.job_event_bus
    store = container.job_events
    try:
        last_seq = int(request.headers.get("last-event-id") or 0)
    except ValueError:
        last_seq = 0

    queue = bus.subscribe(job_id)

    def synthesized_terminal(seq: int) -> JobEvent | None:
        if job.status == JobStatus.FAILED:
            return JobEvent(seq=seq + 1, event="failed", data={
                "error_code": job.error_code or "pipeline_error",
                "error_user_msg": job.error_message or "This generation did not finish.",
            })
        if job.status == JobStatus.SUCCEEDED:
            return JobEvent(seq=seq + 1, event="done", data={"game_id": job.game_id})
        return None

    async def gen():
        nonlocal last_seq
        try:
            saw_terminal = False
            for event in await store.list_since(job_id, last_seq):
                yield _sse_frame(event)
                last_seq = event.seq
                if event.event in _TERMINAL_EVENTS:
                    saw_terminal = True
                    return
            if not saw_terminal:
                synthetic = synthesized_terminal(last_seq)
                if synthetic is not None:
                    yield _sse_frame(synthetic)
                    return
            while True:
                if await request.is_disconnected():
                    return
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=_HEARTBEAT_SECONDS)
                except (TimeoutError, asyncio.TimeoutError):
                    yield ": keep-alive\n\n"
                    continue
                if event.seq <= last_seq:
                    continue
                yield _sse_frame(event)
                last_seq = event.seq
                if event.event in _TERMINAL_EVENTS:
                    return
        finally:
            bus.unsubscribe(job_id, queue)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
