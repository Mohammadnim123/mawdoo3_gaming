"""Codply web views: landing/feed, create, live workspace, game page, edit.

Django owns the product layer (accounts, catalog, social); the generation
engine (FastAPI) remains the source of truth for how a game is built and
served. This module renders the UX and orchestrates engine calls through the
API client; the live generation panel consumes the engine's SSE stream via a
same-origin proxy here.
"""

from __future__ import annotations

import uuid
from urllib.parse import urlsplit

from django.conf import settings
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.db.models import F
from django.http import Http404, JsonResponse, StreamingHttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_GET, require_POST

from core.i18n import stage_label, strings

from games.constants import PROMPT_MAX_CHARS, PROMPT_MIN_CHARS
from games.models import (
    Game,
    GameStatus,
    GenerationJobRef,
    JobStatus,
    JobType,
    Visibility,
)
from games.services.generation_api import GenerationApiError, get_client
from games.services.prompt_validation import PromptValidationUnavailable, validate_prompt
from games.sync import sync_job

_ACTIVE = {JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.AWAITING_INPUT}


def _t(request):
    return strings(getattr(request, "locale", "en"))


def _locale(request) -> str:
    return getattr(request, "locale", "en")


def _game_src(game: Game, locale: str) -> str:
    url = game.play_url
    if not url:
        return ""
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}lang={locale}"


def _game_origin(game: Game) -> str:
    parts = urlsplit(game.play_url)
    return f"{parts.scheme}://{parts.netloc}" if parts.scheme else ""


def _draft_slug() -> str:
    return f"draft-{uuid.uuid4().hex[:12]}"


# ---------------------------------------------------------------------------
# Landing + feed
# ---------------------------------------------------------------------------
GENRES = ["runner", "platformer", "puzzle", "shooter", "arcade", "snake", "breakout", "flappy"]


@require_GET
def home(request):
    from django.contrib.auth import get_user_model

    sort = request.GET.get("sort", "for_you")
    genre = (request.GET.get("genre") or "").strip() or None
    base = Game.objects.filter(
        status=GameStatus.LIVE, visibility=Visibility.PUBLIC
    ).select_related("owner")
    if genre:
        base = base.filter(genre=genre)

    if sort == "following" and request.user.is_authenticated:
        following_ids = list(request.user.following_set.values_list("following_id", flat=True))
        qs = base.filter(owner_id__in=following_ids).order_by("-published_at", "-created_at")
    elif sort == "trending":
        qs = base.order_by("-play_count", "-like_count", "-published_at")
    elif sort == "new":
        qs = base.order_by("-published_at", "-created_at")
    else:
        sort = "for_you"
        qs = base.order_by("-published_at", "-created_at")

    # Right rail: trending now + suggested creators.
    trending = list(
        Game.objects.filter(status=GameStatus.LIVE, visibility=Visibility.PUBLIC)
        .order_by("-play_count", "-like_count")[:5]
    )
    User = get_user_model()
    creators = User.objects.filter(
        games__status=GameStatus.LIVE, games__visibility=Visibility.PUBLIC,
        banned_at__isnull=True,
    ).distinct().order_by("-follower_count")
    if request.user.is_authenticated:
        creators = creators.exclude(id=request.user.id)
    suggested = list(creators[:4])

    return render(request, "pages/home.html", {
        "games": list(qs[: settings.GAMES_PAGE_SIZE]),
        "sort": sort,
        "genre": genre,
        "genres": GENRES,
        "trending": trending,
        "suggested": suggested,
    })


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------
@login_required(login_url="/login")
def create(request):
    if request.method == "POST":
        return _start_create(request)
    return render(request, "pages/create.html", {"idea": (request.GET.get("idea") or "").strip()})


def _start_create(request):
    t = _t(request)
    from billing.services import can_generate

    if not can_generate(request.user):
        messages.error(request, "You've hit today's generation limit — upgrade for more.")
        return redirect("/account/billing")
    prompt = (request.POST.get("prompt") or request.POST.get("idea") or "").strip()
    if len(prompt) < PROMPT_MIN_CHARS:
        messages.error(request, t["prompt_too_short"])
        return render(request, "pages/create.html", {"idea": prompt})
    if len(prompt) > PROMPT_MAX_CHARS:
        messages.error(request, t["prompt_too_long"])
        return render(request, "pages/create.html", {"idea": prompt[:PROMPT_MAX_CHARS]})
    try:
        verdict = validate_prompt(prompt)
    except PromptValidationUnavailable:
        messages.error(request, t["validation_unavailable"])
        return render(request, "pages/create.html", {"idea": prompt})
    if not verdict.valid:
        messages.error(request, verdict.reason or t["invalid_prompt"])
        return render(request, "pages/create.html", {"idea": prompt})

    locale = _locale(request)
    try:
        job = get_client().start_generation(prompt, locale=locale)
    except GenerationApiError:
        messages.error(request, t["service_error"])
        return render(request, "pages/create.html", {"idea": prompt})

    game = Game.objects.create(
        owner=request.user, prompt=prompt, status=GameStatus.DRAFT,
        slug=_draft_slug(), default_locale=locale, visibility=Visibility.PRIVATE,
    )
    GenerationJobRef.objects.create(
        service_job_id=job["id"], user=request.user, game=game,
        type=JobType.CREATE, prompt=prompt, status=JobStatus.QUEUED,
        stage=job.get("stage", ""),
    )
    return redirect(f"/studio/{game.id}")


# ---------------------------------------------------------------------------
# Studio (workspace)
# ---------------------------------------------------------------------------
@login_required(login_url="/login")
def studio(request, game_id):
    game = get_object_or_404(Game, id=game_id, owner=request.user)
    job = game.jobs.order_by("-created_at").first()
    if job is not None and (job.status in _ACTIVE or not game.is_live):
        job = sync_job(job)
        game.refresh_from_db()
    active = job is not None and job.status in _ACTIVE
    locale = _locale(request)
    return render(request, "workspace/studio.html", {
        "game": game,
        "job": job,
        "active": active,
        "versions": list(game.versions.order_by("-version_no")),
        "game_src": _game_src(game, locale) if game.is_live else "",
        "game_origin": _game_origin(game) if game.is_live else "",
    })


@login_required(login_url="/login")
@require_GET
def stream_proxy(request, job_ref_id):
    jr = get_object_or_404(GenerationJobRef, id=job_ref_id, user=request.user)
    last = request.headers.get("Last-Event-ID")

    def gen():
        try:
            yield from get_client().iter_stream(jr.service_job_id, last)
        except GenerationApiError:
            yield b'event: failed\ndata: {"error_user_msg": "stream unavailable"}\n\n'

    resp = StreamingHttpResponse(gen(), content_type="text/event-stream")
    resp["Cache-Control"] = "no-cache"
    resp["X-Accel-Buffering"] = "no"
    return resp


@login_required(login_url="/login")
@require_GET
def job_status(request, job_ref_id):
    jr = get_object_or_404(GenerationJobRef, id=job_ref_id, user=request.user)
    jr = sync_job(jr)
    payload = {
        "status": jr.status,
        "stage": jr.stage,
        "stage_label": stage_label(_locale(request), jr.stage or ""),
        "error": jr.error_message or None,
    }
    if jr.status == JobStatus.SUCCEEDED and jr.game_id:
        payload["redirect_url"] = f"/studio/{jr.game_id}"
        payload["game_id"] = str(jr.game_id)
    return JsonResponse(payload)


# ---------------------------------------------------------------------------
# Public game page
# ---------------------------------------------------------------------------
@require_GET
def game_detail(request, slug):
    game = get_object_or_404(Game.objects.select_related("owner"), slug=slug)
    is_owner = request.user.is_authenticated and game.owner_id == request.user.id
    if game.status == GameStatus.REMOVED:
        raise Http404
    if game.visibility == Visibility.PRIVATE and not is_owner:
        raise Http404
    if not game.is_live and not is_owner:
        raise Http404
    locale = _locale(request)

    from social.models import Comment, Like, Save

    viewer_liked = viewer_saved = viewer_following = False
    if request.user.is_authenticated:
        viewer_liked = Like.objects.filter(user=request.user, game=game).exists()
        viewer_saved = Save.objects.filter(user=request.user, game=game).exists()
        viewer_following = request.user.following_set.filter(following=game.owner).exists()
    comments = list(
        Comment.objects.filter(game=game, parent__isnull=True)
        .select_related("user").order_by("-created_at")[:50]
    )
    return render(request, "game/detail.html", {
        "game": game,
        "is_owner": is_owner,
        "viewer_liked": viewer_liked,
        "viewer_saved": viewer_saved,
        "viewer_following": viewer_following,
        "comments": comments,
        "game_src": _game_src(game, locale) if game.is_live else "",
        "game_origin": _game_origin(game) if game.is_live else "",
    })


# ---------------------------------------------------------------------------
# Publish / edit / remix
# ---------------------------------------------------------------------------
@login_required(login_url="/login")
@require_POST
def game_post(request, game_id):
    game = get_object_or_404(Game, id=game_id, owner=request.user)
    vis = request.POST.get("visibility", Visibility.PUBLIC)
    if vis not in Visibility.values:
        vis = Visibility.PUBLIC
    game.visibility = vis
    game.save(update_fields=["visibility"])
    messages.success(request, _t(request)["ws_post"])
    return redirect(f"/g/{game.slug}" if game.is_live else f"/studio/{game.id}")


@login_required(login_url="/login")
@require_POST
def game_chat(request, game_id):
    game = get_object_or_404(Game, id=game_id, owner=request.user)
    instruction = (request.POST.get("instruction") or "").strip()
    if not instruction or not game.service_game_id:
        return redirect(f"/studio/{game.id}")
    try:
        job = get_client().start_tweak(game.service_game_id, instruction)
    except GenerationApiError:
        messages.error(request, _t(request)["service_error"])
        return redirect(f"/studio/{game.id}")
    GenerationJobRef.objects.create(
        service_job_id=job["id"], user=request.user, game=game,
        type=JobType.EDIT, prompt=instruction, status=JobStatus.QUEUED,
    )
    return redirect(f"/studio/{game.id}")


@login_required(login_url="/login")
@require_POST
def game_remix(request, game_id):
    from billing.services import can_generate

    src = get_object_or_404(Game, id=game_id)
    if src.visibility == Visibility.PRIVATE and src.owner_id != request.user.id:
        raise Http404
    if not can_generate(request.user):
        messages.error(request, "You've hit today's generation limit — upgrade for more.")
        return redirect("/account/billing")
    message = (request.POST.get("message") or "").strip()
    prompt = src.prompt or src.title_en or "a fun game"
    if message:
        prompt = f"{prompt}. {message}"
    locale = _locale(request)
    try:
        job = get_client().start_generation(prompt, locale=locale)
    except GenerationApiError:
        messages.error(request, _t(request)["service_error"])
        return redirect(f"/g/{src.slug}")
    game = Game.objects.create(
        owner=request.user, prompt=prompt, status=GameStatus.DRAFT,
        slug=_draft_slug(), default_locale=locale, visibility=Visibility.PRIVATE,
        remixed_from=src,
    )
    GenerationJobRef.objects.create(
        service_job_id=job["id"], user=request.user, game=game,
        type=JobType.REMIX, prompt=prompt, status=JobStatus.QUEUED,
    )
    Game.objects.filter(id=src.id).update(remix_count=F("remix_count") + 1)
    return redirect(f"/studio/{game.id}")
