"""UI views — presentation and user interaction only.

Every generation action delegates to the generation service through the API
client (games.services.generation_api); no generation or storage logic lives
here. The one AI call this app owns is the pre-dispatch prompt validation
(games.services.prompt_validation). Pages are server-rendered; the only
JavaScript is progressive enhancement (status polling, game postMessage
events), so the whole flow also works without it.
"""

from __future__ import annotations

from urllib.parse import urlsplit

from django.conf import settings
from django.http import HttpRequest, HttpResponse, JsonResponse
from django.shortcuts import redirect, render
from django.urls import reverse
from django.views.decorators.http import require_GET, require_POST

from games import i18n
from games.constants import PROMPT_MAX_CHARS, PROMPT_MIN_CHARS, JobStatus
from games.services.generation_api import (
    GenerationApiError,
    GenerationApiUnavailable,
    get_client,
)
from games.services.prompt_validation import (
    PromptValidationUnavailable,
    validate_prompt,
)

_LANG_COOKIE = "lang"
_LANG_COOKIE_MAX_AGE = 365 * 24 * 3600


# ---------------------------------------------------------------------------
# Language + rendering helpers
# ---------------------------------------------------------------------------


def _lang(request: HttpRequest) -> str:
    candidate = (
        request.GET.get("lang")
        or request.POST.get("lang")
        or request.COOKIES.get(_LANG_COOKIE)
    )
    return candidate if candidate in ("ar", "en") else settings.WEB_DEFAULT_LOCALE


def _render(
    request: HttpRequest, template: str, context: dict, *, status: int = 200
) -> HttpResponse:
    lang = _lang(request)
    other = "en" if lang == "ar" else "ar"
    # POST re-renders must not offer the POST-only URL as a toggle target.
    toggle_path = context.pop(
        "toggle_path", request.path if request.method == "GET" else reverse("games:home")
    )
    context.update(
        {
            "lang": lang,
            "dir": "rtl" if lang == "ar" else "ltr",
            "toggle_url": f"{toggle_path}?lang={other}",
            "t": i18n.strings(lang),
        }
    )
    response = render(request, template, context, status=status)
    if request.GET.get("lang") == lang:
        response.set_cookie(
            _LANG_COOKIE, lang, max_age=_LANG_COOKIE_MAX_AGE, samesite="Lax"
        )
    return response


def _redirect(request: HttpRequest, viewname: str, *args: str) -> HttpResponse:
    return redirect(f"{reverse(viewname, args=args)}?lang={_lang(request)}")


def _error_page(request: HttpRequest, message: str, *, status: int) -> HttpResponse:
    t = i18n.strings(_lang(request))
    return _render(
        request,
        "games/error.html",
        {"error_title": t["error_title"], "error_message": message, "toggle_path": "/"},
        status=status,
    )


# Failure codes whose message is written for the creator (the out-of-scope
# reason comes from the LLM, language-matched and explanatory). Every other
# code carries technical detail (gate feedback, tracebacks, timeouts) that
# must never reach the page — those render as a friendly localized message.
_USER_SAFE_ERROR_CODES = frozenset({"out_of_scope"})


def _job_error_message(job: dict, t: dict) -> str | None:
    error = job.get("error")
    if not error:
        return None
    if error.get("code") in _USER_SAFE_ERROR_CODES and error.get("message"):
        return error["message"]
    return t["gen_failed_message"]


def _game_src(game: dict, lang: str) -> str:
    """Play URL carrying the UI language. No cache-buster: the play origins
    serve with no-cache + revalidation, so a finished edit is picked up on
    the next load while unchanged files stay cheap 304s."""
    sep = "&" if "?" in game["play_url"] else "?"
    return f"{game['play_url']}{sep}lang={lang}"


def _game_origin(game: dict) -> str:
    """Origin the sandboxed game iframe runs on — play.js only accepts
    postMessage events from exactly this origin."""
    parts = urlsplit(game["play_url"])
    return f"{parts.scheme}://{parts.netloc}"


# ---------------------------------------------------------------------------
# Home: prompt input + list of generated games
# ---------------------------------------------------------------------------


@require_GET
def home(request: HttpRequest) -> HttpResponse:
    return _home(request)


def _home(
    request: HttpRequest,
    *,
    gen_error: str | None = None,
    prompt_rejected: str | None = None,
    status: int = 200,
) -> HttpResponse:
    games: list[dict] = []
    load_error: str | None = None
    try:
        page = get_client().list_games(limit=settings.GAMES_PAGE_SIZE)
        games = page.get("items", [])
    except GenerationApiError as exc:
        load_error = str(exc)
    return _render(
        request,
        "games/home.html",
        {
            "games": games,
            "load_error": load_error,
            "gen_error": gen_error,
            "prompt_rejected": prompt_rejected,
            "toggle_path": reverse("games:home"),
        },
        status=status,
    )


@require_POST
def generate(request: HttpRequest) -> HttpResponse:
    prompt = (request.POST.get("prompt") or "").strip()
    if not prompt:
        return _redirect(request, "games:home")
    t = i18n.strings(_lang(request))

    # Pre-dispatch LLM validation, owned by this app: is it a game, and is it
    # deliverable mini-game complexity? Invalid prompts never become jobs —
    # the user gets the (language-matched) reason immediately. Length is
    # checked first so an over/under-sized prompt costs no LLM call; the
    # service still enforces the same limits at dispatch.
    if len(prompt) < PROMPT_MIN_CHARS:
        return _home(request, prompt_rejected=t["prompt_too_short"])
    if len(prompt) > PROMPT_MAX_CHARS:
        return _home(request, prompt_rejected=t["prompt_too_long"])
    try:
        verdict = validate_prompt(prompt)
    except PromptValidationUnavailable:
        return _home(request, gen_error=t["validation_unavailable"], status=502)
    if not verdict.valid:
        return _home(request, prompt_rejected=verdict.reason or t["invalid_prompt"])

    try:
        job = get_client().start_generation(prompt)
    except GenerationApiError as exc:
        return _home(request, gen_error=str(exc), status=exc.status_code or 502)
    return _redirect(request, "games:generation_status", job["id"])


# ---------------------------------------------------------------------------
# Generation progress (shared by first generation and edits)
# ---------------------------------------------------------------------------


@require_GET
def generation_status(request: HttpRequest, job_id: str) -> HttpResponse:
    lang = _lang(request)
    try:
        job = get_client().get_generation(job_id)
    except GenerationApiError as exc:
        return _error_page(request, str(exc), status=exc.status_code or 502)

    if job["status"] == JobStatus.SUCCEEDED and job.get("game_id"):
        return _redirect(request, "games:play", job["game_id"])

    return _render(
        request,
        "games/status.html",
        {
            "job": job,
            "state": "failed" if job["status"] == JobStatus.FAILED else "running",
            "error_message": _job_error_message(job, i18n.strings(lang)),
            "stage_label": i18n.stage_label(lang, job.get("stage", "")),
            "poll_interval_ms": settings.STATUS_POLL_INTERVAL_MS,
            "refresh_seconds": max(1, settings.STATUS_POLL_INTERVAL_MS // 1000),
        },
    )


@require_GET
def generation_status_data(request: HttpRequest, job_id: str) -> JsonResponse:
    """Polling endpoint for the status page's progressive enhancement."""
    lang = _lang(request)
    try:
        job = get_client().get_generation(job_id)
    except GenerationApiError as exc:
        return JsonResponse(
            {"status": "error", "message": str(exc)}, status=exc.status_code or 502
        )
    payload: dict = {
        "status": job["status"],
        "stage": job.get("stage"),
        "stage_label": i18n.stage_label(lang, job.get("stage", "")),
        "error": _job_error_message(job, i18n.strings(lang)),
    }
    if job["status"] == JobStatus.SUCCEEDED and job.get("game_id"):
        payload["redirect_url"] = (
            f"{reverse('games:play', args=[job['game_id']])}?lang={lang}"
        )
    return JsonResponse(payload)


# ---------------------------------------------------------------------------
# Play + edit
# ---------------------------------------------------------------------------


def _render_play(
    request: HttpRequest,
    game_id: str,
    *,
    edit_error: GenerationApiError | None = None,
) -> HttpResponse:
    """The one place the play page is rendered — with or without a failed-edit
    banner, the context is built identically."""
    lang = _lang(request)
    try:
        game = get_client().get_game(game_id)
    except GenerationApiError as exc:
        original = edit_error or exc
        return _error_page(request, str(original), status=original.status_code or 502)
    context: dict = {
        "game": game,
        "game_src": _game_src(game, lang),
        "game_origin": _game_origin(game),
    }
    status = 200
    if edit_error is not None:
        context["edit_error"] = str(edit_error)
        context["toggle_path"] = reverse("games:play", args=[game_id])
        status = edit_error.status_code or 502
    return _render(request, "games/play.html", context, status=status)


@require_GET
def play(request: HttpRequest, game_id: str) -> HttpResponse:
    return _render_play(request, game_id)


@require_POST
def edit(request: HttpRequest, game_id: str) -> HttpResponse:
    instruction = (request.POST.get("instruction") or "").strip()
    if not instruction:
        return _redirect(request, "games:play", game_id)
    try:
        job = get_client().start_tweak(game_id, instruction)
    except GenerationApiUnavailable as exc:
        return _error_page(request, str(exc), status=502)
    except GenerationApiError as exc:
        return _render_play(request, game_id, edit_error=exc)
    return _redirect(request, "games:generation_status", job["id"])
