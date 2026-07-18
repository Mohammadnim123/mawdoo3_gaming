"""Contract social endpoints: comments, follows, profiles, suggested creators."""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db.models import F, Sum
from django.http import JsonResponse
from django.utils import timezone
from games.models import GameStatus, Visibility
from social.models import Comment, CommentEdit, CommentLike, Follow
from social.services import add_comment, delete_comment, toggle_follow

from .http import (
    FORBIDDEN,
    NOT_FOUND,
    VALIDATION_ERROR,
    ApiError,
    api_view,
    json_body,
    no_content,
    page_params,
)
from .serializers import (
    comment_payload,
    connection_user,
    feed_item,
    game_owner,
    profile_payload,
)
from .views_games import _public_game
from .views_me import _locale, _viewer_state

PREVIEW_REPLIES = 2


def _comment_or_404(comment_id) -> Comment:
    try:
        return Comment.objects.select_related("user", "game", "game__owner").get(id=comment_id)
    except (Comment.DoesNotExist, ValueError):
        raise ApiError(NOT_FOUND, "No such comment.") from None


def _viewer_comment_likes(request, comment_ids) -> set:
    if not request.user.is_authenticated or not comment_ids:
        return set()
    return set(
        CommentLike.objects.filter(user=request.user, comment_id__in=comment_ids)
        .values_list("comment_id", flat=True)
    )


# ---------------------------------------------------------------------------
# Comments
# ---------------------------------------------------------------------------

@api_view("GET", "POST")
def comments(request, handle):
    game = _public_game(request, handle)
    if request.method == "POST":
        return _create_comment(request, game)

    parent_id = request.GET.get("parent") or None
    offset, limit = page_params(request, default_limit=20)
    qs = Comment.objects.filter(game=game).select_related("user")
    if parent_id:
        qs = qs.filter(parent_id=parent_id).order_by("created_at")
    else:
        qs = qs.filter(parent__isnull=True).order_by("-created_at")
    rows = list(qs[offset : offset + limit + 1])
    has_more = len(rows) > limit
    rows = rows[:limit]

    liked = _viewer_comment_likes(request, [c.id for c in rows])
    items = []
    if parent_id:
        for c in rows:
            items.append(comment_payload(c, viewer_liked=c.id in liked))
    else:
        # Top-level listings carry the first replies (oldest first, ≤2).
        reply_map: dict = {}
        parents_with_replies = [c.id for c in rows if c.reply_count]
        if parents_with_replies:
            replies = (
                Comment.objects.filter(parent_id__in=parents_with_replies)
                .select_related("user").order_by("created_at")
            )
            for r in replies:
                bucket = reply_map.setdefault(r.parent_id, [])
                if len(bucket) < PREVIEW_REPLIES:
                    bucket.append(r)
        preview_ids = [r.id for bucket in reply_map.values() for r in bucket]
        liked |= _viewer_comment_likes(request, preview_ids)
        for c in rows:
            previews = [
                comment_payload(r, viewer_liked=r.id in liked)
                for r in reply_map.get(c.id, [])
            ]
            items.append(comment_payload(c, viewer_liked=c.id in liked,
                                         preview_replies=previews))
    return JsonResponse({
        "items": items,
        "next_cursor": str(offset + limit) if has_more else None,
    })


def _create_comment(request, game):
    if not request.user.is_authenticated:
        raise ApiError("unauthorized", "Log in to comment.", status=401)
    body = json_body(request)
    text = str(body.get("body") or "").strip()
    if not (1 <= len(text) <= 500):
        raise ApiError(VALIDATION_ERROR, "Comments need 1–500 characters.")
    parent = None
    parent_id = body.get("parent_comment_id")
    if parent_id:
        parent = Comment.objects.filter(id=parent_id, game=game).first()
        if parent is None:
            raise ApiError(NOT_FOUND, "No such comment.")
    comment = add_comment(request.user, game, text, parent=parent)
    return JsonResponse(comment_payload(comment, viewer_liked=False), status=201)


@api_view("PATCH", "DELETE", auth=True)
def comment_detail(request, comment_id):
    comment = _comment_or_404(comment_id)
    user = request.user
    if request.method == "DELETE":
        can_moderate = (
            comment.user_id == user.id
            or comment.game.owner_id == user.id
            or user.is_admin
        )
        if not can_moderate:
            raise ApiError(FORBIDDEN, "You can't delete that comment.")
        delete_comment(comment)
        return no_content()

    if comment.user_id != user.id:
        raise ApiError(FORBIDDEN, "You can only edit your own comments.")
    if comment.deleted:
        raise ApiError(NOT_FOUND, "No such comment.")
    text = str(json_body(request).get("body") or "").strip()
    if not (1 <= len(text) <= 500):
        raise ApiError(VALIDATION_ERROR, "Comments need 1–500 characters.")
    if text != comment.body:
        CommentEdit.objects.create(comment=comment, body=comment.body)
        comment.body = text
        comment.edited_at = timezone.now()
        comment.save(update_fields=["body", "edited_at"])
    liked = _viewer_comment_likes(request, [comment.id])
    return JsonResponse(comment_payload(comment, viewer_liked=comment.id in liked))


@api_view("GET")
def comment_history(request, comment_id):
    comment = _comment_or_404(comment_id)
    return JsonResponse({
        "items": [
            {"body": e.body, "created_at": e.created_at.isoformat()}
            for e in comment.edits.all()
        ]
    })


@api_view("POST", "DELETE", auth=True)
def comment_like(request, comment_id):
    comment = _comment_or_404(comment_id)
    if request.method == "POST":
        _, created = CommentLike.objects.get_or_create(user=request.user, comment=comment)
        if created:
            Comment.objects.filter(id=comment.id).update(like_count=F("like_count") + 1)
    else:
        deleted, _ = CommentLike.objects.filter(user=request.user, comment=comment).delete()
        if deleted:
            Comment.objects.filter(id=comment.id, like_count__gt=0).update(
                like_count=F("like_count") - 1
            )
    return no_content()


# ---------------------------------------------------------------------------
# Follows & profiles
# ---------------------------------------------------------------------------

def _user_or_404(handle):
    User = get_user_model()
    try:
        return User.objects.get(handle=handle)
    except User.DoesNotExist:
        raise ApiError(NOT_FOUND, "No such creator.") from None


@api_view("POST", "DELETE", auth=True)
def follow(request, handle):
    target = _user_or_404(handle)
    if target.id == request.user.id:
        raise ApiError(VALIDATION_ERROR, "You can't follow yourself.")
    following = Follow.objects.filter(follower=request.user, following=target).exists()
    if (request.method == "POST") != following:
        toggle_follow(request.user, target)
    return no_content()


@api_view("GET")
def profile(request, handle):
    user = _user_or_404(handle)
    games = user.games.filter(status=GameStatus.LIVE, visibility=Visibility.PUBLIC)
    agg = games.aggregate(plays=Sum("play_count"), likes=Sum("like_count"))
    viewer_following = None
    if request.user.is_authenticated:
        viewer_following = Follow.objects.filter(
            follower=request.user, following=user
        ).exists()
    return JsonResponse(profile_payload(
        user,
        stats={
            "games": games.count(),
            "plays": agg["plays"] or 0,
            "likes": agg["likes"] or 0,
            "followers": user.follower_count,
            "following": user.following_count,
        },
        viewer_following=viewer_following,
    ))


@api_view("GET")
def profile_games(request, handle):
    user = _user_or_404(handle)
    offset, limit = page_params(request, default_limit=12)
    qs = user.games.filter(
        status=GameStatus.LIVE, visibility=Visibility.PUBLIC
    ).select_related("owner", "current_version").order_by("-published_at", "-created_at")
    rows = list(qs[offset : offset + limit + 1])
    has_more = len(rows) > limit
    rows = rows[:limit]
    viewer = _viewer_state(request, [g.id for g in rows])
    locale = _locale(request)
    return JsonResponse({
        "items": [
            feed_item(g, locale,
                      viewer=viewer.get(g.id) if request.user.is_authenticated else None)
            for g in rows
        ],
        "next_cursor": str(offset + limit) if has_more else None,
    })


def _viewer_following(request, users) -> dict:
    """Map user-id → True for the users the viewer already follows (one query).
    Empty for anonymous viewers — callers pass viewer_following=None then."""
    if not request.user.is_authenticated or not users:
        return {}
    ids = [u.id for u in users]
    followed = set(
        Follow.objects.filter(follower=request.user, following_id__in=ids)
        .values_list("following_id", flat=True)
    )
    return {uid: uid in followed for uid in ids}


def _connections_page(request, users, offset, limit, has_more):
    viewer = _viewer_following(request, users)
    anonymous = not request.user.is_authenticated
    return JsonResponse({
        "items": [
            connection_user(u, viewer_following=None if anonymous else viewer.get(u.id, False))
            for u in users
        ],
        "next_cursor": str(offset + limit) if has_more else None,
    })


@api_view("GET")
def followers(request, handle):
    user = _user_or_404(handle)
    offset, limit = page_params(request)
    qs = Follow.objects.filter(following=user).select_related("follower").order_by("-created_at")
    rows = list(qs[offset : offset + limit + 1])
    has_more = len(rows) > limit
    return _connections_page(request, [f.follower for f in rows[:limit]], offset, limit, has_more)


@api_view("GET")
def following(request, handle):
    user = _user_or_404(handle)
    offset, limit = page_params(request)
    qs = Follow.objects.filter(follower=user).select_related("following").order_by("-created_at")
    rows = list(qs[offset : offset + limit + 1])
    has_more = len(rows) > limit
    return _connections_page(request, [f.following for f in rows[:limit]], offset, limit, has_more)


@api_view("GET")
def suggested_creators(request):
    User = get_user_model()
    creators = User.objects.filter(
        games__status=GameStatus.LIVE, games__visibility=Visibility.PUBLIC,
        banned_at__isnull=True,
    ).distinct().order_by("-follower_count")
    if request.user.is_authenticated:
        creators = creators.exclude(id=request.user.id)
        creators = creators.exclude(
            id__in=request.user.following_set.values_list("following_id", flat=True)
        )
    return JsonResponse({
        "items": [
            {**game_owner(u), "follower_count": u.follower_count}
            for u in creators[:4]
        ]
    })
