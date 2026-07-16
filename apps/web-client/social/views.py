from __future__ import annotations

from django.contrib.auth import get_user_model
from django.contrib.auth.decorators import login_required
from django.db.models import Q
from django.http import Http404, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.decorators.http import require_GET, require_POST

from games.models import Game, GameStatus, Visibility

from . import services
from .models import Comment, Notification

User = get_user_model()


def _back(request, default: str = "/") -> str:
    ref = request.META.get("HTTP_REFERER", "")
    if ref and url_has_allowed_host_and_scheme(ref, allowed_hosts={request.get_host()}):
        return ref
    return default


def _wants_json(request) -> bool:
    return (request.headers.get("X-Requested-With") == "fetch"
            or "application/json" in request.headers.get("Accept", ""))


def _visible_game(request, game_id):
    game = get_object_or_404(Game.objects.select_related("owner"), id=game_id)
    is_owner = request.user.is_authenticated and game.owner_id == request.user.id
    if game.status == GameStatus.REMOVED:
        raise Http404
    if game.visibility == Visibility.PRIVATE and not is_owner:
        raise Http404
    return game


@require_POST
@login_required(login_url="/login")
def like(request, game_id):
    game = _visible_game(request, game_id)
    liked = services.toggle_like(request.user, game)
    game.refresh_from_db(fields=["like_count"])
    if _wants_json(request):
        return JsonResponse({"liked": liked, "count": game.like_count})
    return redirect(_back(request, f"/g/{game.slug}"))


@require_POST
@login_required(login_url="/login")
def save(request, game_id):
    game = _visible_game(request, game_id)
    saved = services.toggle_save(request.user, game)
    game.refresh_from_db(fields=["save_count"])
    if _wants_json(request):
        return JsonResponse({"saved": saved, "count": game.save_count})
    return redirect(_back(request, f"/g/{game.slug}"))


@require_POST
def share(request, game_id):
    game = _visible_game(request, game_id)
    services.record_share(game, user=request.user, session_hash=request.session.session_key or "")
    if _wants_json(request):
        return JsonResponse({"ok": True})
    return redirect(_back(request, f"/g/{game.slug}"))


@require_POST
@login_required(login_url="/login")
def comment_add(request, game_id):
    game = _visible_game(request, game_id)
    body = (request.POST.get("body") or "").strip()
    parent_id = request.POST.get("parent")
    if body:
        parent = Comment.objects.filter(id=parent_id, game=game).first() if parent_id else None
        services.add_comment(request.user, game, body, parent=parent)
    return redirect(_back(request, f"/g/{game.slug}"))


@require_POST
@login_required(login_url="/login")
def comment_delete(request, comment_id):
    comment = get_object_or_404(Comment.objects.select_related("game", "game__owner"), id=comment_id)
    if not (comment.user_id == request.user.id
            or comment.game.owner_id == request.user.id
            or request.user.is_admin):
        raise Http404
    services.delete_comment(comment)
    return redirect(_back(request, f"/g/{comment.game.slug}"))


@require_POST
@login_required(login_url="/login")
def follow(request, handle):
    target = get_object_or_404(User, handle=handle, banned_at__isnull=True)
    following = services.toggle_follow(request.user, target)
    if _wants_json(request):
        return JsonResponse({"following": following})
    return redirect(_back(request, f"/u/{handle}"))


@require_GET
@login_required(login_url="/login")
def notifications(request):
    items = list(request.user.notifications.select_related("actor", "game")[:50])
    # Mark unread as read once viewed.
    request.user.notifications.filter(read=False).update(read=True)
    return render(request, "social/notifications.html", {"items": items})


@require_GET
def search(request):
    q = (request.GET.get("q") or "").strip()
    games = []
    if q:
        games = list(
            Game.objects.filter(status=GameStatus.LIVE, visibility=Visibility.PUBLIC)
            .filter(Q(title_en__icontains=q) | Q(title_ar__icontains=q) | Q(prompt__icontains=q))
            .select_related("owner")
            .order_by("-play_count", "-published_at")[:48]
        )
    return render(request, "social/search.html", {"q": q, "games": games})
