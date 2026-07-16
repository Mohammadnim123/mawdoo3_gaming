"""Contract job endpoints: generate, snapshot, SSE stream, answers, cancel, draft."""

from __future__ import annotations

import uuid

from django.http import JsonResponse, StreamingHttpResponse
from games.models import Game, GameStatus, GenerationJobRef, JobStatus, JobType, Visibility
from games.services.generation_api import GenerationApiError, get_client
from games.sync import sync_job

from .http import (
    MODERATION_BLOCKED,
    NOT_FOUND,
    QUOTA_EXCEEDED,
    VALIDATION_ERROR,
    ApiError,
    api_view,
    engine_error,
    json_body,
    no_content,
)
from .serializers import job_payload
from .views_me import _locale

_ACTIVE = {JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.AWAITING_INPUT}


def _ref(request, job_id) -> GenerationJobRef:
    try:
        return GenerationJobRef.objects.select_related("game", "game__current_version").get(
            id=job_id, user=request.user
        )
    except (GenerationJobRef.DoesNotExist, ValueError):
        raise ApiError(NOT_FOUND, "No such job.") from None


@api_view("POST", auth=True)
def generate(request):
    from billing.services import can_generate
    from games.constants import PROMPT_MAX_CHARS, PROMPT_MIN_CHARS
    from games.services.prompt_validation import (
        PromptValidationUnavailable,
        validate_prompt,
    )

    if not can_generate(request.user):
        raise ApiError(QUOTA_EXCEEDED, "You've hit today's generation limit.")
    body = json_body(request)
    prompt = str(body.get("prompt") or "").strip()
    options = body.get("options") or {}
    skip_questions = bool(options.get("skip_questions")) if isinstance(options, dict) else False
    if not (PROMPT_MIN_CHARS <= len(prompt) <= PROMPT_MAX_CHARS):
        raise ApiError(VALIDATION_ERROR,
                       f"Prompts need {PROMPT_MIN_CHARS}–{PROMPT_MAX_CHARS} characters.")
    try:
        verdict = validate_prompt(prompt)
        if not verdict.valid:
            raise ApiError(MODERATION_BLOCKED, verdict.reason or "That prompt can't be built.")
    except PromptValidationUnavailable:
        pass  # the engine's own moderation still applies

    locale = _locale(request)
    try:
        job = get_client().start_generation(prompt, locale=locale,
                                            skip_questions=skip_questions)
    except GenerationApiError as exc:
        raise engine_error(exc) from None
    game = Game.objects.create(
        owner=request.user, prompt=prompt, status=GameStatus.DRAFT,
        slug=f"draft-{uuid.uuid4().hex[:12]}", default_locale=locale,
        visibility=Visibility.PRIVATE,
    )
    ref = GenerationJobRef.objects.create(
        service_job_id=job["id"], user=request.user, game=game,
        type=JobType.CREATE, prompt=prompt, status=JobStatus.QUEUED,
        stage=job.get("stage", ""),
    )
    return JsonResponse({"job_id": str(ref.id), "game_id": str(game.id)}, status=202)


_STEP_STATUS = {"pending", "running", "done", "failed", "completed"}
_TRANSCRIPT_EVENTS = {"activity", "message", "file", "heal"}


def _fold_events(events: list[dict]) -> tuple[list[dict], list[dict]]:
    """Fold the engine event log into contract steps[] + transcript[]."""
    steps: list[dict] = []
    by_key: dict[str, dict] = {}
    transcript: list[dict] = []
    activity_index: dict[str, int] = {}
    for row in events:
        name = row.get("event")
        data = row.get("data") or {}
        if name == "step":
            key = str(data.get("step") or "")
            status = str(data.get("status") or "running")
            if status not in _STEP_STATUS:
                status = "running"
            if key in by_key:
                by_key[key]["status"] = status
                by_key[key]["label"] = data.get("label") or by_key[key]["label"]
            else:
                entry = {"step": key, "label": data.get("label") or key, "status": status,
                         "started_at": None, "ended_at": None}
                by_key[key] = entry
                steps.append(entry)
        elif name in _TRANSCRIPT_EVENTS:
            if name == "activity" and data.get("id"):
                # Activity upserts collapse to final state at first-seen position.
                key = str(data["id"])
                if key in activity_index:
                    transcript[activity_index[key]] = {"event": name, "data": data}
                    continue
                activity_index[key] = len(transcript)
            transcript.append({"event": name, "data": data})
    return steps, transcript


@api_view("GET", auth=True)
def snapshot(request, job_id):
    ref = _ref(request, job_id)
    if ref.status in _ACTIVE:
        ref = sync_job(ref)
        if ref.game_id:
            ref.game.refresh_from_db()
    steps: list[dict] = []
    transcript: list[dict] = []
    client = get_client()
    if hasattr(client, "get_events"):
        try:
            payload = client.get_events(ref.service_job_id)
            steps, transcript = _fold_events(payload.get("items") or [])
        except GenerationApiError:
            pass
    return JsonResponse(job_payload(ref, _locale(request), steps=steps, transcript=transcript))


@api_view("GET", auth=True)
def stream(request, job_id):
    ref = _ref(request, job_id)
    last = request.headers.get("Last-Event-ID")

    def gen():
        try:
            yield from get_client().iter_stream(ref.service_job_id, last)
        except GenerationApiError as exc:
            if exc.status_code == 404:
                yield b'event: failed\ndata: {"error_user_msg": "stream unavailable"}\n\n'

    resp = StreamingHttpResponse(gen(), content_type="text/event-stream")
    resp["Cache-Control"] = "no-cache"
    resp["X-Accel-Buffering"] = "no"
    return resp


@api_view("POST", auth=True)
def answers(request, job_id):
    ref = _ref(request, job_id)
    body = json_body(request).get("answers") or {}
    if not isinstance(body, dict):
        raise ApiError(VALIDATION_ERROR, "answers must be an object")
    cleaned = {str(k)[:64]: str(v)[:300] for k, v in body.items()}
    try:
        get_client().submit_answers(ref.service_job_id, cleaned)
    except GenerationApiError as exc:
        raise engine_error(exc) from None
    ref.status = JobStatus.RUNNING
    ref.questions = []
    ref.save(update_fields=["status", "questions", "updated_at"])
    return JsonResponse({"status": "resumed"})


@api_view("POST", auth=True)
def cancel(request, job_id):
    ref = _ref(request, job_id)
    try:
        get_client().cancel_generation(ref.service_job_id)
    except GenerationApiError as exc:
        raise engine_error(exc) from None
    ref.status = JobStatus.CANCELLED
    ref.save(update_fields=["status", "updated_at"])
    return no_content()


@api_view("GET", auth=True)
def draft(request, job_id):
    ref = _ref(request, job_id)
    client = get_client()
    if hasattr(client, "get_draft"):
        try:
            payload = client.get_draft(ref.service_job_id)
            return JsonResponse({
                "content": payload.get("content"),
                "files": payload.get("files") or [],
            })
        except GenerationApiError:
            pass
    return JsonResponse({"content": None, "files": []})
