from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

USER = settings.AUTH_USER_MODEL


class Play(models.Model):
    """A recorded play (≥5s), deduped per session upstream."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    game = models.ForeignKey("games.Game", on_delete=models.CASCADE, related_name="plays")
    user = models.ForeignKey(USER, on_delete=models.SET_NULL, null=True, blank=True)
    session_hash = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        indexes = [models.Index(fields=["game", "-created_at"])]


class Like(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(USER, on_delete=models.CASCADE, related_name="likes")
    game = models.ForeignKey("games.Game", on_delete=models.CASCADE, related_name="likes")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        unique_together = [("user", "game")]


class Save(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(USER, on_delete=models.CASCADE, related_name="saves")
    game = models.ForeignKey("games.Game", on_delete=models.CASCADE, related_name="saves")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        unique_together = [("user", "game")]
        ordering = ["-created_at"]


class Share(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    game = models.ForeignKey("games.Game", on_delete=models.CASCADE, related_name="shares")
    user = models.ForeignKey(USER, on_delete=models.SET_NULL, null=True, blank=True)
    session_hash = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(default=timezone.now)


class Comment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    game = models.ForeignKey("games.Game", on_delete=models.CASCADE, related_name="comments")
    user = models.ForeignKey(USER, on_delete=models.CASCADE, related_name="comments")
    body = models.CharField(max_length=500)
    parent = models.ForeignKey("self", on_delete=models.CASCADE, null=True, blank=True,
                               related_name="replies")
    reply_count = models.PositiveIntegerField(default=0)
    like_count = models.PositiveIntegerField(default=0)
    deleted = models.BooleanField(default=False)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["game", "parent", "-created_at"])]


class CommentLike(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(USER, on_delete=models.CASCADE)
    comment = models.ForeignKey(Comment, on_delete=models.CASCADE, related_name="likes")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        unique_together = [("user", "comment")]


class Follow(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    follower = models.ForeignKey(USER, on_delete=models.CASCADE, related_name="following_set")
    following = models.ForeignKey(USER, on_delete=models.CASCADE, related_name="follower_set")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        unique_together = [("follower", "following")]


class Notification(models.Model):
    class Type(models.TextChoices):
        LIKE = "like"
        COMMENT = "comment"
        REPLY = "reply"
        FOLLOW = "follow"
        REMIX = "remix"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    recipient = models.ForeignKey(USER, on_delete=models.CASCADE, related_name="notifications")
    actor = models.ForeignKey(USER, on_delete=models.CASCADE, related_name="+")
    type = models.CharField(max_length=16, choices=Type.choices)
    game = models.ForeignKey("games.Game", on_delete=models.CASCADE, null=True, blank=True)
    comment_excerpt = models.CharField(max_length=200, blank=True)
    read = models.BooleanField(default=False)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["recipient", "read", "-created_at"])]


class Report(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    reporter = models.ForeignKey(USER, on_delete=models.SET_NULL, null=True, blank=True)
    game = models.ForeignKey("games.Game", on_delete=models.CASCADE, null=True, blank=True,
                             related_name="reports")
    comment = models.ForeignKey(Comment, on_delete=models.CASCADE, null=True, blank=True,
                                related_name="reports")
    reason = models.CharField(max_length=280)
    resolved = models.BooleanField(default=False)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]
