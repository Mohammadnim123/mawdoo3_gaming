"""Contract job endpoints: generate, snapshot, SSE stream, answers, cancel, draft."""

from __future__ import annotations

import json
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
from .serializers import job_payload, play_src
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
    from django.core.cache import cache
    from games.services.prompt_validation import (
        PromptValidationUnavailable,
        validate_prompt,
    )

    # Contract idempotency: a network retry with the same key must not spend
    # a second generation or create a duplicate draft.
    idem_key = (request.headers.get("Idempotency-Key") or "")[:128]
    if idem_key:
        cached = cache.get(f"genidem:{request.user.id}:{idem_key}")
        if cached:
            return JsonResponse(cached, status=202)

    if not can_generate(request.user):
        raise ApiError(QUOTA_EXCEEDED, "You've hit today's generation limit.")
    body = json_body(request)
    prompt = str(body.get("prompt") or "").strip()
    options = body.get("options") or {}
    skip_questions = bool(options.get("skip_questions")) if isinstance(options, dict) else False
    # Contract bounds (3..1000) — fail fast before the moderation LLM.
    if not (3 <= len(prompt) <= 1000):
        raise ApiError(VALIDATION_ERROR, "Prompts need 3–1000 characters.")
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
    payload = {"job_id": str(ref.id), "game_id": str(game.id)}
    if idem_key:
        cache.set(f"genidem:{request.user.id}:{idem_key}", payload, 60 * 60 * 24)
    return JsonResponse(payload, status=202)


_STEP_STATUS = {"pending", "running", "done", "failed", "completed"}
_TRANSCRIPT_EVENTS = {"activity", "message", "file", "heal"}


def _fold_events(events: list[dict], *, terminal: bool = False,
                 failed: bool = False) -> tuple[list[dict], list[dict]]:
    """Fold the engine event log into contract steps[] + transcript[].

    The engine's log may carry only `running` transitions (older jobs predate
    completion frames), so a NEW step starting closes the previous one, and a
    terminal job settles whatever is still running (`done`, or `failed` for
    the last step of a failed job) — mirroring the reference reducer.
    """
    steps: list[dict] = []
    by_key: dict[str, dict] = {}
    transcript: list[dict] = []
    activity_index: dict[str, int] = {}
    last_running: dict | None = None
    for row in events:
        name = row.get("event")
        data = row.get("data") or {}
        if name == "step":
            key = str(data.get("step") or "")
            status = str(data.get("status") or "running")
            if status not in _STEP_STATUS:
                status = "running"
            if status == "running" and last_running is not None \
                    and last_running.get("step") != key \
                    and last_running.get("status") == "running":
                last_running["status"] = "completed"
            if key in by_key:
                by_key[key]["status"] = status
                by_key[key]["label"] = data.get("label") or by_key[key]["label"]
            else:
                entry = {"step": key, "label": data.get("label") or key, "status": status,
                         "started_at": None, "ended_at": None}
                by_key[key] = entry
                steps.append(entry)
            if status == "running":
                last_running = by_key[key]
        elif name in _TRANSCRIPT_EVENTS:
            if name == "activity" and data.get("id"):
                # Activity upserts collapse to final state at first-seen position.
                key = str(data["id"])
                if key in activity_index:
                    transcript[activity_index[key]] = {"event": name, "data": data}
                    continue
                activity_index[key] = len(transcript)
            transcript.append({"event": name, "data": data})
    if terminal:
        running = [s for s in steps if s["status"] == "running"]
        for i, entry in enumerate(running):
            if failed and i == len(running) - 1:
                entry["status"] = "failed"
            else:
                entry["status"] = "completed"
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
            steps, transcript = _fold_events(
                payload.get("items") or [],
                terminal=ref.status not in _ACTIVE,
                failed=ref.status == JobStatus.FAILED,
            )
        except GenerationApiError:
            pass
    return JsonResponse(job_payload(ref, _locale(request), steps=steps, transcript=transcript))


def _rewrite_frame(ref: GenerationJobRef, locale: str, frame: bytes) -> bytes:
    """Translate engine SSE frames into the contract the islands parse.

    The engine speaks its own dialect for a few payloads; the vendored zod
    schemas silently DROP non-conforming frames, so `done`/`failed` must be
    rewritten or the workspace never sees a job finish live:
      - done: engine {game_id: <engine id>, title_en/_ar, version_*} →
        contract {game_id: <django uuid>, version_id, play_url, cover_url?,
        title}. Finalizing via sync_job here also mirrors the version row at
        the exact moment the engine publishes it.
      - failed: contract requires `refunded`; cancelled shows as failed with
        the stop message (reference cancel semantics).
      - questions: engine `default_option_id` → contract `default`.
    Everything else passes through untouched (ids/seq preserved).
    """
    lines = frame.split(b"\n")
    event = ""
    data_lines = []
    other_lines = []
    for line in lines:
        if line.startswith(b"event:"):
            event = line[6:].strip().decode("utf-8", "replace")
            other_lines.append(line)
        elif line.startswith(b"data:"):
            data_lines.append(line[5:].strip())
        else:
            other_lines.append(line)
    if event not in ("done", "failed", "questions"):
        return frame + b"\n\n"
    try:
        data = json.loads(b"\n".join(data_lines) or b"{}")
    except ValueError:
        return frame + b"\n\n"

    if event == "questions":
        for q in data.get("questions") or []:
            if isinstance(q, dict) and "default" not in q and q.get("default_option_id"):
                q["default"] = q["default_option_id"]
    else:
        sync_job(ref)
        ref.refresh_from_db()
        game = ref.game
        if event == "done":
            if game is not None:
                game.refresh_from_db()
            version = game.current_version if (game and game.current_version_id) else None
            data = {
                "game_id": str(game.id) if game else None,
                "version_id": str(version.id) if version else None,
                "play_url": play_src(game.play_url, locale) if (game and game.is_live) else "",
                "title": game.title(locale) if game else "",
                **({"cover_url": game.cover_url} if (game and game.cover_url) else {}),
            }
        else:  # failed
            message = data.get("error_user_msg") or ref.error_message or "Generation failed."
            if ref.status == JobStatus.CANCELLED:
                message = data.get("error_user_msg") or "Cancelled."
            data = {
                "error_code": data.get("error_code") or ref.error_code or "server_error",
                "error_user_msg": message,
                "refunded": bool(data.get("refunded", False)),
            }
    payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
    return b"\n".join(other_lines) + b"\ndata: " + payload + b"\n\n"


def _frame_stream(ref: GenerationJobRef, locale: str, chunks) :
    """Incremental SSE framer: buffer engine bytes, yield rewritten frames."""
    buffer = b""
    for chunk in chunks:
        buffer += chunk
        while b"\n\n" in buffer:
            frame, buffer = buffer.split(b"\n\n", 1)
            frame = frame.strip(b"\r\n")
            if not frame:
                continue
            yield _rewrite_frame(ref, locale, frame)
    if buffer.strip():
        yield _rewrite_frame(ref, locale, buffer.strip(b"\r\n"))


@api_view("GET", auth=True)
def stream(request, job_id):
    ref = _ref(request, job_id)
    last = request.headers.get("Last-Event-ID")
    locale = _locale(request)

    def gen():
        try:
            upstream = get_client().iter_stream(ref.service_job_id, last)
            yield from _frame_stream(ref, locale, upstream)
        except GenerationApiError as exc:
            if exc.status_code == 404:
                yield (b'event: failed\ndata: {"error_code": "not_found", '
                       b'"error_user_msg": "stream unavailable", "refunded": false}\n\n')

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
