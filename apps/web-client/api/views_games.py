"""Contract game endpoints: feed, detail, versions, engagement, chat, source."""

from __future__ import annotations

import uuid

from django.core.cache import cache
from django.db.models import F
from django.http import JsonResponse
from django.utils import timezone
from games.models import (
    Game,
    GameStatus,
    GameVersion,
    GenerationJobRef,
    JobStatus,
    JobType,
    Visibility,
)
from games.services.generation_api import GenerationApiError, get_client
from social.models import Comment, Like, Play, Save

from .http import (
    CONFLICT,
    FORBIDDEN,
    NOT_FOUND,
    QUOTA_EXCEEDED,
    VALIDATION_ERROR,
    ApiError,
    api_view,
    engine_error,
    json_body,
    no_content,
    page_params,
)
from .serializers import (
    feed_item,
    game_detail,
    game_payload,
    play_src,
    version_payload,
)
from .views_me import _locale, _viewer_state

_ACTIVE = {JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.AWAITING_INPUT}

PREVIEW_COMMENTS = 2


def _resolve_game(handle: str, *, select=("owner", "current_version")):
    """Games are addressed by UUID (mutations) or slug (public reads)."""
    qs = Game.objects.select_related(*select)
    try:
        return qs.get(id=uuid.UUID(str(handle)))
    except (ValueError, Game.DoesNotExist):
        try:
            return qs.get(slug=handle)
        except Game.DoesNotExist:
            raise ApiError(NOT_FOUND, "No such game.") from None


def _visible_to(game: Game, user) -> bool:
    if game.status == GameStatus.REMOVED:
        return False
    is_owner = user.is_authenticated and game.owner_id == user.id
    if game.visibility == Visibility.PRIVATE and not is_owner:
        return False
    if not game.is_live and not is_owner:
        return False
    return True


def _owned_game(request, handle) -> Game:
    game = _resolve_game(handle)
    if not request.user.is_authenticated or game.owner_id != request.user.id:
        raise ApiError(FORBIDDEN, "Only the owner can do that.")
    if game.status == GameStatus.REMOVED:
        raise ApiError(NOT_FOUND, "No such game.")
    return game


def _preview_comments_map(game_ids) -> dict:
    if not game_ids:
        return {}
    rows = (
        Comment.objects.filter(game_id__in=game_ids, parent__isnull=True, deleted=False)
        .select_related("user")
        .order_by("game_id", "-created_at")
    )
    out: dict = {}
    for c in rows:
        bucket = out.setdefault(c.game_id, [])
        if len(bucket) < PREVIEW_COMMENTS:
            bucket.append(c)
    return out


# ---------------------------------------------------------------------------
# Feed & detail
# ---------------------------------------------------------------------------

@api_view("GET")
def feed(request):
    sort = request.GET.get("sort") or "for_you"
    genre = (request.GET.get("genre") or "").strip() or None
    q = (request.GET.get("q") or "").strip() or None
    offset, limit = page_params(request, default_limit=12)

    qs = Game.objects.filter(
        status=GameStatus.LIVE, visibility=Visibility.PUBLIC
    ).select_related("owner", "current_version")
    if genre:
        qs = qs.filter(genre=genre)
    if q:
        from django.db.models import Q

        qs = qs.filter(Q(title_en__icontains=q) | Q(title_ar__icontains=q)
                       | Q(summary_en__icontains=q))
    if sort == "following" and request.user.is_authenticated:
        following_ids = list(
            request.user.following_set.values_list("following_id", flat=True)
        )
        qs = qs.filter(owner_id__in=following_ids).order_by("-published_at", "-created_at")
    elif sort == "following":
        qs = qs.none()
    elif sort == "trending":
        qs = qs.order_by("-play_count", "-like_count", "-published_at")
    else:  # for_you / new
        qs = qs.order_by("-published_at", "-created_at")

    rows = list(qs[offset : offset + limit + 1])
    has_more = len(rows) > limit
    rows = rows[:limit]
    viewer = _viewer_state(request, [g.id for g in rows])
    previews = _preview_comments_map([g.id for g in rows])
    locale = _locale(request)
    return JsonResponse({
        "items": [
            feed_item(
                g, locale,
                viewer=viewer.get(g.id) if request.user.is_authenticated else None,
                preview_comments=previews.get(g.id) or [],
            )
            for g in rows
        ],
        "next_cursor": str(offset + limit) if has_more else None,
    })


@api_view("GET", "PATCH", "DELETE")
def game_resource(request, handle):
    """GET /games/{slug} (public detail) + PATCH/DELETE /games/{id} (owner)."""
    if request.method in ("PATCH", "DELETE"):
        return patch_or_delete_game(request, handle)
    game = _resolve_game(handle, select=("owner", "current_version", "remixed_from"))
    if not _visible_to(game, request.user):
        raise ApiError(NOT_FOUND, "No such game.")
    viewer = _viewer_state(request, [game.id]) if request.user.is_authenticated else {}
    previews = _preview_comments_map([game.id])
    return JsonResponse(game_detail(
        game, _locale(request),
        viewer=viewer.get(game.id),
        preview_comments=previews.get(game.id) or [],
    ))


# ---------------------------------------------------------------------------
# Owner mutations
# ---------------------------------------------------------------------------

@api_view("PATCH", "DELETE", auth=True)
def patch_or_delete_game(request, handle):
    game = _owned_game(request, handle)
    if request.method == "DELETE":
        game.status = GameStatus.REMOVED
        game.visibility = Visibility.PRIVATE
        game.save(update_fields=["status", "visibility", "updated_at"])
        return no_content()

    body = json_body(request)
    fields: list[str] = []
    if "title" in body:
        title = str(body.get("title") or "").strip()
        if not (1 <= len(title) <= 120):
            raise ApiError(VALIDATION_ERROR, "Titles need 1–120 characters.")
        if game.default_locale == "ar":
            game.title_ar = title
        else:
            game.title_en = title
        fields += ["title_en", "title_ar"]
    if "description" in body:
        description = str(body.get("description") or "")
        if len(description) > 2000:
            raise ApiError(VALIDATION_ERROR, "Descriptions are capped at 2000 characters.")
        game.summary_en = description
        game.summary_ar = description
        fields += ["summary_en", "summary_ar"]
    if "visibility" in body:
        vis = str(body.get("visibility") or "")
        if vis not in Visibility.values:
            raise ApiError(VALIDATION_ERROR, "Unknown visibility.")
        game.visibility = vis
        if vis in (Visibility.PUBLIC, Visibility.UNLISTED) and game.published_at is None:
            game.published_at = timezone.now()
            fields.append("published_at")
        fields.append("visibility")
    if fields:
        game.save(update_fields=list(set(fields)) + ["updated_at"])
    viewer = _viewer_state(request, [game.id])
    return JsonResponse(game_payload(game, _locale(request), viewer=viewer.get(game.id)))


# ---------------------------------------------------------------------------
# Versions / rollback / source / files
# ---------------------------------------------------------------------------

@api_view("GET", auth=True)
def versions(request, handle):
    game = _owned_game(request, handle)
    locale = _locale(request)
    return JsonResponse({
        "items": [version_payload(v, locale) for v in game.versions.order_by("version_no")]
    })


@api_view("POST", auth=True)
def rollback(request, handle):

    game = _owned_game(request, handle)
    version_id = json_body(request).get("version_id")
    version = game.versions.filter(id=version_id).first()
    if version is None:
        raise ApiError(NOT_FOUND, "No such version.")
    # Delegate to the existing view logic by calling the engine + flipping the
    # pointer here (game_rollback is form-shaped; reimplement the small core).
    if game.jobs.filter(status__in=_ACTIVE).exists():
        raise ApiError(CONFLICT, "This game is being updated.")
    if game.service_game_id and version.service_version_id:
        try:
            get_client().rollback(game.service_game_id, version.service_version_id)
        except GenerationApiError as exc:
            already_current = False
            if exc.status_code == 409:
                try:
                    catalog = get_client().list_versions(game.service_game_id)
                    already_current = (
                        catalog.get("current_version_id") == version.service_version_id
                    )
                except GenerationApiError:
                    already_current = False
            if not already_current:
                raise engine_error(exc) from None
    game.current_version = version
    game.save(update_fields=["current_version", "updated_at"])
    return JsonResponse({
        "version_id": str(version.id),
        "play_url": play_src(version.play_url, _locale(request)),
    })


def _engine_version(game: Game, version: GameVersion):
    if not game.service_game_id or not version.service_version_id:
        raise ApiError(NOT_FOUND, "This version has no source.")
    return game.service_game_id, version.service_version_id


@api_view("GET", auth=True)
def version_source(request, handle, version_id):
    game = _owned_game(request, handle)
    version = game.versions.filter(id=version_id).first()
    if version is None:
        raise ApiError(NOT_FOUND, "No such version.")
    svc_game, svc_version = _engine_version(game, version)
    source = get_client().get_version_source(svc_game, svc_version)
    return JsonResponse({"source_html": source.get("game_js", "") or source.get("source_html", "")})


@api_view("GET", auth=True)
def version_files(request, handle, version_id):
    """Bundle listing for the Code view. Prefers the engine's file catalog;
    falls back to the known template bundle shape."""
    game = _owned_game(request, handle)
    version = game.versions.filter(id=version_id).first()
    if version is None:
        raise ApiError(NOT_FOUND, "No such version.")
    svc_game, svc_version = _engine_version(game, version)
    client = get_client()
    base = version.play_url.rsplit("/", 1)[0] if version.play_url else ""

    if hasattr(client, "get_version_files"):
        try:
            listing = client.get_version_files(svc_game, svc_version)
            items = listing.get("items")
            if isinstance(items, list):
                return JsonResponse({"items": items})
        except GenerationApiError:
            pass

    source = client.get_version_source(svc_game, svc_version)

    def entry(path: str, content_type: str, *, editable: bool, kind: str) -> dict:
        return {
            "path": path,
            "content_type": content_type,
            "url": f"{base}/{path}" if base else path,
            "editable": editable,
            "kind": kind,
            # Text bundle files are always renderable in the read-only viewer.
            "viewable": True,
        }

    items = [
        entry("index.html", "text/html", editable=False, kind="code"),
        entry("game.js", "text/javascript", editable=True, kind="code"),
    ]
    if source.get("game_css"):
        items.append(entry("game.css", "text/css", editable=False, kind="code"))
    return JsonResponse({"items": items})


@api_view("PUT", auth=True)
def save_source(request, handle):
    """Hand-edited source → lint gate → new immutable version (engine-side)."""
    game = _owned_game(request, handle)
    body = json_body(request)
    source_html = str(body.get("source_html") or "")
    if not source_html.strip():
        raise ApiError(VALIDATION_ERROR, "Source can't be empty.")
    if not game.service_game_id:
        raise ApiError(NOT_FOUND, "This game has no engine record.")
    if game.jobs.filter(status__in=_ACTIVE).exists():
        raise ApiError(CONFLICT, "This game is being updated.")
    client = get_client()
    if not hasattr(client, "save_source"):
        raise ApiError(VALIDATION_ERROR, "Source editing isn't available yet.")
    try:
        result = client.save_source(game.service_game_id, source_html)
    except GenerationApiError as exc:
        if exc.status_code == 422:
            details = getattr(exc, "details", None) or {}
            raise ApiError(VALIDATION_ERROR, str(exc),
                           details=details if isinstance(details, dict) else {}) from None
        raise
    # Mirror the new engine version locally and flip the pointer.
    from games.sync import mirror_engine_version

    version = mirror_engine_version(game, result, change_summary="Hand-edited")
    return JsonResponse(
        {"version_id": str(version.id), "play_url": play_src(version.play_url, _locale(request))},
        status=201,
    )


# ---------------------------------------------------------------------------
# Engagement
# ---------------------------------------------------------------------------

def _public_game(request, handle) -> Game:
    game = _resolve_game(handle)
    if not _visible_to(game, request.user):
        raise ApiError(NOT_FOUND, "No such game.")
    return game


@api_view("POST")
def play(request, handle):
    game = _public_game(request, handle)
    body = json_body(request)
    session_hash = str(body.get("session_hash") or "")[:64]
    if not session_hash:
        raise ApiError(VALIDATION_ERROR, "session_hash required.")
    if cache.add(f"play:{game.id}:{session_hash}", 1, 1800):
        Play.objects.create(
            game=game,
            user=request.user if request.user.is_authenticated else None,
            session_hash=session_hash,
        )
        Game.objects.filter(id=game.id).update(play_count=F("play_count") + 1)
    return no_content()


@api_view("POST", auth=True)
def report(request, handle):
    from social.models import Report

    game = _public_game(request, handle)
    reason = str(json_body(request).get("reason") or "").strip()
    if not (1 <= len(reason) <= 500):
        raise ApiError(VALIDATION_ERROR, "Tell us what's wrong (up to 500 characters).")
    Report.objects.create(reporter=request.user, game=game, reason=reason[:280])
    return JsonResponse({}, status=201)


@api_view("POST", "DELETE", auth=True)
def like(request, handle):
    from social.services import toggle_like

    game = _public_game(request, handle)
    liked = Like.objects.filter(user=request.user, game=game).exists()
    if (request.method == "POST") != liked:
        toggle_like(request.user, game)
    return no_content()


@api_view("POST", "DELETE", auth=True)
def save_game(request, handle):
    from social.services import toggle_save

    game = _public_game(request, handle)
    saved = Save.objects.filter(user=request.user, game=game).exists()
    if (request.method == "POST") != saved:
        toggle_save(request.user, game)
    return no_content()


@api_view("POST")
def share(request, handle):
    from social.services import record_share

    game = _public_game(request, handle)
    session_hash = str(json_body(request).get("session_hash") or "")[:64]
    record_share(game, user=request.user, session_hash=session_hash)
    return no_content()


# ---------------------------------------------------------------------------
# Chat / remix / session
# ---------------------------------------------------------------------------

@api_view("GET", "POST", auth=True)
def chat(request, handle):
    game = _owned_game(request, handle)
    if request.method == "GET":
        return _chat_history(request, game)
    return _send_chat(request, game)


def _chat_history(request, game: Game):
    """Chat history synthesized from the job mirror: each job is one user
    message carrying its terminal state (the thread builder splices job cards
    from `job_id` + `job.status`)."""
    offset, limit = page_params(request, default_limit=50)
    refs = list(game.jobs.order_by("-created_at")[offset : offset + limit + 1])
    has_more = len(refs) > limit
    refs = refs[:limit]
    from .serializers import job_status_value

    items = [
        {
            "id": f"{ref.id}:user",
            "role": "user",
            "content": ref.prompt,
            "created_at": ref.created_at.isoformat(),
            "job_id": str(ref.id),
            "image_url": None,
            "job": {
                "status": job_status_value(ref),
                "error_code": ref.error_code or None,
            },
        }
        for ref in refs
    ]
    return JsonResponse({
        "items": items,
        "next_cursor": str(offset + limit) if has_more else None,
    })


def _send_chat(request, game: Game):
    body = json_body(request)
    message = str(body.get("message") or "").strip()
    image_base64 = body.get("image_base64") or None
    if not message and not image_base64:
        raise ApiError(VALIDATION_ERROR, "a message or an image is required")
    if not game.service_game_id:
        raise ApiError(CONFLICT, "This game hasn't finished its first build yet.")
    if game.jobs.filter(status__in=_ACTIVE).exists():
        raise ApiError(CONFLICT, "This game is already being updated.")
    client = get_client()
    try:
        if image_base64 and hasattr(client, "start_tweak_with_image"):
            job = client.start_tweak_with_image(game.service_game_id, message, image_base64)
        else:
            job = client.start_tweak(game.service_game_id,
                                     message or "Apply the attached screenshot feedback.")
    except GenerationApiError as exc:
        raise engine_error(exc) from None
    ref = GenerationJobRef.objects.create(
        service_job_id=job["id"], user=request.user, game=game,
        type=JobType.EDIT, prompt=message or "(image)", status=JobStatus.QUEUED,
    )
    return JsonResponse({"job_id": str(ref.id)})


@api_view("POST", auth=True)
def remix(request, handle):
    from billing.services import can_generate

    src = _resolve_game(handle)
    if not _visible_to(src, request.user):
        raise ApiError(NOT_FOUND, "No such game.")
    if not can_generate(request.user):
        raise ApiError(QUOTA_EXCEEDED, "You've hit today's generation limit.")
    message = str(json_body(request).get("message") or "").strip()
    prompt = src.prompt or src.title_en or "a fun game"
    if message:
        prompt = f"{prompt}. {message}"
    locale = _locale(request)
    try:
        job = get_client().start_generation(prompt, locale=locale)
    except GenerationApiError as exc:
        raise engine_error(exc) from None
    game = Game.objects.create(
        owner=request.user, prompt=prompt, status=GameStatus.DRAFT,
        slug=f"draft-{uuid.uuid4().hex[:12]}", default_locale=locale,
        visibility=Visibility.PRIVATE, remixed_from=src,
    )
    ref = GenerationJobRef.objects.create(
        service_job_id=job["id"], user=request.user, game=game,
        type=JobType.REMIX, prompt=prompt, status=JobStatus.QUEUED,
    )
    Game.objects.filter(id=src.id).update(remix_count=F("remix_count") + 1)
    return JsonResponse({"new_game_id": str(game.id), "job_id": str(ref.id)})


@api_view("POST", auth=True)
def session_reset(request, handle):
    """Our engine keeps no per-game conversational memory — nothing to wipe,
    but the affordance must succeed so the workspace behaves identically."""
    game = _owned_game(request, handle)
    return JsonResponse({"id": str(game.id), "session_reset": True})


@api_view("POST", auth=True)
def screenshot(request, handle):
    """Server-side capture is not available (no headless browser); the client
    falls back gracefully when this 404s — same as reference games whose
    capture worker is down."""
    raise ApiError(NOT_FOUND, "Server capture isn't available.")
