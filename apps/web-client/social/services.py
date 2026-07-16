"""Engagement operations: like/save/share/follow/comment + notifications.

Counters are denormalized onto Game/User and updated with F() expressions in
the same logical operation, so the feed never issues per-card count queries.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db.models import F

from games.models import Game

from .models import Comment, Follow, Like, Notification, Save, Share


def _notify(recipient, actor, kind, game=None, comment_excerpt=""):
    if recipient is None or actor is None or recipient.id == actor.id:
        return
    Notification.objects.create(
        recipient=recipient, actor=actor, type=kind, game=game,
        comment_excerpt=comment_excerpt[:200],
    )


# -- likes ------------------------------------------------------------------
def toggle_like(user, game) -> bool:
    obj, created = Like.objects.get_or_create(user=user, game=game)
    if created:
        Game.objects.filter(id=game.id).update(like_count=F("like_count") + 1)
        _notify(game.owner, user, Notification.Type.LIKE, game)
        return True
    obj.delete()
    Game.objects.filter(id=game.id, like_count__gt=0).update(like_count=F("like_count") - 1)
    Notification.objects.filter(
        recipient=game.owner, actor=user, type=Notification.Type.LIKE, game=game, read=False
    ).delete()
    return False


# -- saves ------------------------------------------------------------------
def toggle_save(user, game) -> bool:
    obj, created = Save.objects.get_or_create(user=user, game=game)
    if created:
        Game.objects.filter(id=game.id).update(save_count=F("save_count") + 1)
        return True
    obj.delete()
    Game.objects.filter(id=game.id, save_count__gt=0).update(save_count=F("save_count") - 1)
    return False


# -- shares -----------------------------------------------------------------
def record_share(game, user=None, session_hash=""):
    Share.objects.create(game=game, user=user if (user and user.is_authenticated) else None,
                         session_hash=session_hash[:64])
    Game.objects.filter(id=game.id).update(share_count=F("share_count") + 1)


# -- follows ----------------------------------------------------------------
def toggle_follow(follower, following) -> bool:
    if follower.id == following.id:
        return False
    obj, created = Follow.objects.get_or_create(follower=follower, following=following)
    User = get_user_model()
    if created:
        User.objects.filter(id=follower.id).update(following_count=F("following_count") + 1)
        User.objects.filter(id=following.id).update(follower_count=F("follower_count") + 1)
        _notify(following, follower, Notification.Type.FOLLOW)
        return True
    obj.delete()
    User.objects.filter(id=follower.id, following_count__gt=0).update(
        following_count=F("following_count") - 1)
    User.objects.filter(id=following.id, follower_count__gt=0).update(
        follower_count=F("follower_count") - 1)
    Notification.objects.filter(
        recipient=following, actor=follower, type=Notification.Type.FOLLOW, read=False
    ).delete()
    return False


# -- comments ---------------------------------------------------------------
def add_comment(user, game, body, parent=None) -> Comment:
    depth_parent = parent.parent if (parent and parent.parent_id) else parent  # flatten depth>1
    comment = Comment.objects.create(user=user, game=game, body=body[:500], parent=depth_parent)
    Game.objects.filter(id=game.id).update(comment_count=F("comment_count") + 1)
    if depth_parent is not None:
        Comment.objects.filter(id=depth_parent.id).update(reply_count=F("reply_count") + 1)
        _notify(depth_parent.user, user, Notification.Type.REPLY, game, body)
    else:
        _notify(game.owner, user, Notification.Type.COMMENT, game, body)
    return comment


def delete_comment(comment) -> None:
    if comment.deleted:
        return
    comment.deleted = True
    comment.body = ""
    comment.save(update_fields=["deleted", "body"])
    Game.objects.filter(id=comment.game_id, comment_count__gt=0).update(
        comment_count=F("comment_count") - 1)
