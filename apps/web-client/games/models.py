from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone


class Visibility(models.TextChoices):
    PUBLIC = "public", "Public"
    UNLISTED = "unlisted", "Unlisted"
    PRIVATE = "private", "Private"


class GameStatus(models.TextChoices):
    DRAFT = "draft", "Draft"       # project exists, no published version yet
    LIVE = "live", "Live"          # has a playable current_version
    FAILED = "failed", "Failed"    # first generation failed, still conversable
    REMOVED = "removed", "Removed"  # soft-deleted / taken down


class Game(models.Model):
    """The product record for a game. Ownership, slug, social counts and
    visibility live here; the blueprint, bundle and version files live in the
    generation-service (referenced by ``service_game_id``)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                              related_name="games")
    slug = models.SlugField(max_length=64, unique=True)

    title_en = models.CharField(max_length=140, blank=True)
    title_ar = models.CharField(max_length=140, blank=True)
    genre = models.CharField(max_length=40, blank=True)
    summary_en = models.TextField(blank=True)
    summary_ar = models.TextField(blank=True)
    default_locale = models.CharField(max_length=2, default="en")
    prompt = models.TextField(blank=True)

    visibility = models.CharField(max_length=10, choices=Visibility.choices,
                                  default=Visibility.PRIVATE)
    status = models.CharField(max_length=10, choices=GameStatus.choices,
                              default=GameStatus.DRAFT)
    cover_url = models.CharField(max_length=500, blank=True)

    # Link to the generation engine.
    service_game_id = models.CharField(max_length=64, blank=True, db_index=True)
    current_version = models.ForeignKey("GameVersion", on_delete=models.SET_NULL,
                                        null=True, blank=True, related_name="+")

    remixed_from = models.ForeignKey("self", on_delete=models.SET_NULL, null=True,
                                     blank=True, related_name="remixes")

    # Denormalized social counters.
    play_count = models.PositiveIntegerField(default=0)
    like_count = models.PositiveIntegerField(default=0)
    comment_count = models.PositiveIntegerField(default=0)
    save_count = models.PositiveIntegerField(default=0)
    share_count = models.PositiveIntegerField(default=0)
    remix_count = models.PositiveIntegerField(default=0)

    published_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "visibility", "-published_at"]),
            models.Index(fields=["-created_at"]),
        ]

    def __str__(self) -> str:
        return self.title_en or self.title_ar or self.slug

    def title(self, locale: str = "en") -> str:
        if locale == "ar":
            return self.title_ar or self.title_en or self.slug
        return self.title_en or self.title_ar or self.slug

    def summary(self, locale: str = "en") -> str:
        return (self.summary_ar if locale == "ar" else self.summary_en) or ""

    @property
    def is_live(self) -> bool:
        return self.status == GameStatus.LIVE and self.current_version_id is not None

    @property
    def play_url(self) -> str:
        return self.current_version.play_url if self.current_version_id else ""


class GameVersion(models.Model):
    """An immutable published version of a game. Mirrors an engine version."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name="versions")
    version_no = models.PositiveIntegerField()
    parent = models.ForeignKey("self", on_delete=models.SET_NULL, null=True, blank=True,
                               related_name="children")
    change_summary = models.CharField(max_length=280, blank=True)
    play_url = models.CharField(max_length=500, blank=True)
    service_version_id = models.CharField(max_length=64, blank=True)
    created_by_job = models.ForeignKey("GenerationJobRef", on_delete=models.SET_NULL,
                                       null=True, blank=True, related_name="+")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["game", "version_no"]
        unique_together = [("game", "version_no")]

    def __str__(self) -> str:
        return f"{self.game_id} v{self.version_no}"


class JobType(models.TextChoices):
    CREATE = "create", "Create"
    EDIT = "edit", "Edit"
    REMIX = "remix", "Remix"


class JobStatus(models.TextChoices):
    QUEUED = "queued", "Queued"
    RUNNING = "running", "Running"
    AWAITING_INPUT = "awaiting_input", "Awaiting input"
    SUCCEEDED = "succeeded", "Succeeded"
    FAILED = "failed", "Failed"
    CANCELLED = "cancelled", "Cancelled"
    EXPIRED = "expired", "Expired"


class GenerationJobRef(models.Model):
    """Local mirror of a generation-engine job (for ownership, listing, and
    resolving stream/status without leaking the engine's internal ids)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    service_job_id = models.CharField(max_length=64, db_index=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                             null=True, blank=True, related_name="jobs")
    game = models.ForeignKey(Game, on_delete=models.SET_NULL, null=True, blank=True,
                             related_name="jobs")
    type = models.CharField(max_length=8, choices=JobType.choices, default=JobType.CREATE)
    status = models.CharField(max_length=16, choices=JobStatus.choices,
                              default=JobStatus.QUEUED)
    stage = models.CharField(max_length=32, blank=True)
    prompt = models.TextField(blank=True)
    error_code = models.CharField(max_length=64, blank=True)
    error_message = models.CharField(max_length=280, blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.type} job {self.service_job_id} ({self.status})"
