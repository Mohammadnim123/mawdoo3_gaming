"""Reconcile a local job mirror with the generation engine.

When the engine finishes a job, this promotes the local draft ``Game`` into a
live game with an immutable ``GameVersion`` (metadata fetched from the engine).
Idempotent: safe to call repeatedly (on studio load, on the SSE `done` event,
or from a poller)."""

from __future__ import annotations

import logging

from django.utils import timezone
from django.utils.text import slugify

from games.models import (
    Game,
    GameStatus,
    GameVersion,
    GenerationJobRef,
    JobStatus,
)
from games.services.generation_api import GenerationApiError, get_client

logger = logging.getLogger(__name__)

_ENGINE_STATUS = {
    "queued": JobStatus.QUEUED,
    "running": JobStatus.RUNNING,
    "awaiting_input": JobStatus.AWAITING_INPUT,
    "succeeded": JobStatus.SUCCEEDED,
    "failed": JobStatus.FAILED,
    "cancelled": JobStatus.CANCELLED,
    "expired": JobStatus.EXPIRED,
}

_TERMINAL = {JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.CANCELLED, JobStatus.EXPIRED}


def unique_slug(title: str, exclude_id=None) -> str:
    base = slugify(title)[:48] or "game"
    slug = base
    i = 0
    while Game.objects.filter(slug=slug).exclude(id=exclude_id).exists():
        i += 1
        slug = f"{base}-{i}"
    return slug


def mirror_engine_version(game: Game, engine_result: dict,
                          change_summary: str = "") -> GameVersion:
    """Mirror an engine version produced OUTSIDE a job (e.g. a hand-edited
    source save) as a local GameVersion and flip the pointer."""
    from django.db.models import Max

    local_max = game.versions.aggregate(n=Max("version_no"))["n"] or 0
    version = GameVersion.objects.create(
        game=game,
        version_no=local_max + 1,
        parent=game.current_version,
        play_url=engine_result.get("play_url") or game.play_url,
        service_version_id=engine_result.get("version_id") or "",
        change_summary=change_summary[:280],
    )
    game.current_version = version
    game.save(update_fields=["current_version", "updated_at"])
    return version


def sync_job(job_ref: GenerationJobRef) -> GenerationJobRef:
    """Pull the engine job snapshot into the local mirror; finalize on success."""
    client = get_client()
    try:
        snap = client.get_generation(job_ref.service_job_id)
    except GenerationApiError:
        return job_ref

    status = _ENGINE_STATUS.get(snap.get("status", ""), job_ref.status)
    err = snap.get("error") or {}
    error_code = (err.get("code") or "")[:64]
    # The engine records creator cancels / clarify timeouts as FAILED with a
    # distinguishing error code — surface them as their own local statuses so
    # the workspace shows "stopped" instead of a red failure card.
    if status == JobStatus.FAILED and error_code == "cancelled":
        status = JobStatus.CANCELLED
    elif status == JobStatus.FAILED and error_code == "expired":
        status = JobStatus.EXPIRED
    job_ref.status = status
    job_ref.stage = snap.get("stage") or job_ref.stage
    job_ref.questions = snap.get("questions") or []
    job_ref.error_code = error_code
    job_ref.error_message = (err.get("message") or "")[:280]

    game = job_ref.game
    if status == JobStatus.SUCCEEDED and snap.get("game_id") and game is not None:
        _finalize_success(client, job_ref, game, snap["game_id"])
    elif status == JobStatus.FAILED and game is not None and game.status == GameStatus.DRAFT:
        game.status = GameStatus.FAILED
        game.save(update_fields=["status"])

    job_ref.save()
    return job_ref


def _finalize_success(client, job_ref: GenerationJobRef, game: Game, svc_game_id: str) -> None:
    # Idempotent: one version per job.
    if GameVersion.objects.filter(created_by_job=job_ref).exists():
        return
    try:
        svc = client.get_game(svc_game_id)
    except GenerationApiError:
        return

    title = svc.get("title") or {}
    summary = svc.get("summary", "") or ""
    was_draft = game.status != GameStatus.LIVE or game.current_version_id is None

    game.service_game_id = svc_game_id
    game.title_en = title.get("en") or game.title_en
    game.title_ar = title.get("ar") or game.title_ar
    game.cover_url = svc.get("cover_url") or game.cover_url
    game.genre = svc.get("genre", "") or game.genre
    game.summary_en = summary or game.summary_en
    game.summary_ar = summary or game.summary_ar
    game.default_locale = svc.get("default_locale", "en") or "en"

    # The engine's version catalog is the source of truth: mirror THE version
    # this job produced (matched by the engine job id — the newest row is not
    # necessarily ours when syncs arrive out of order). Falls back to the
    # game-level play_url with no version link when the catalog is unreachable.
    from django.db.models import Max

    local_max = game.versions.aggregate(n=Max("version_no"))["n"] or 0
    version_no = local_max + 1
    svc_version_id = ""
    play_url = svc.get("play_url", "") or ""
    try:
        items = client.list_versions(svc_game_id).get("items") or []
        mine = [v for v in items if v.get("job_id") == job_ref.service_job_id]
        engine_version = mine[-1] if mine else (items[-1] if items else None)
        if engine_version:
            svc_version_id = engine_version.get("id") or ""
            play_url = engine_version.get("play_url") or play_url
            engine_no = int(engine_version.get("version_no") or 0)
            if engine_no > local_max:  # never collide with (game, version_no)
                version_no = engine_no
    except GenerationApiError:
        logger.info("engine versions unavailable for %s; using game-level url", svc_game_id)

    version = GameVersion.objects.create(
        game=game,
        version_no=version_no,
        parent=None if was_draft else game.current_version,
        play_url=play_url,
        service_version_id=svc_version_id,
        created_by_job=job_ref,
        change_summary="" if was_draft else job_ref.prompt[:280],
    )
    game.current_version = version
    game.status = GameStatus.LIVE
    if was_draft:
        game.slug = unique_slug(game.title_en or game.title_ar or "game", exclude_id=game.id)
        game.published_at = timezone.now()
    game.save()
    logger.info("finalized game %s (v%s) from job %s", game.id, version.version_no, job_ref.id)
