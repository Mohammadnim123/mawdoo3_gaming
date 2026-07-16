from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin
from django.db import models
from django.utils import timezone
from django.utils.text import slugify

from .managers import UserManager


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class User(AbstractBaseUser, PermissionsMixin):
    """Platform user. Email is the login identity; handle is the public @name."""

    class Role(models.TextChoices):
        USER = "user", "User"
        ADMIN = "admin", "Admin"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    handle = models.SlugField(max_length=30, unique=True, blank=True)
    display_name = models.CharField(max_length=80, blank=True)
    avatar_url = models.URLField(blank=True)
    bio = models.CharField(max_length=200, blank=True)
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.USER)

    # Economy (billing lands in P3; wired dark from the start).
    credits_balance_cents = models.IntegerField(default=0)
    daily_gen_quota = models.PositiveIntegerField(default=10)

    # Denormalized social counters (kept in sync by social signals/services).
    follower_count = models.PositiveIntegerField(default=0)
    following_count = models.PositiveIntegerField(default=0)

    email_verified = models.BooleanField(default=False)
    banned_at = models.DateTimeField(null=True, blank=True)
    # Bumping this invalidates any outstanding password-reset/magic links.
    auth_epoch = models.PositiveIntegerField(default=0)

    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    created_at = models.DateTimeField(default=timezone.now)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []  # handle & display_name auto-filled in save()

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.handle or self.email

    def save(self, *args, **kwargs):
        if not self.handle:
            self.handle = self._unique_handle(self.email.split("@", 1)[0])
        if not self.display_name:
            self.display_name = self.handle
        super().save(*args, **kwargs)

    @staticmethod
    def _unique_handle(base: str) -> str:
        root = slugify(base).replace("-", "")[:24] or "player"
        candidate = root
        n = 0
        while User.objects.filter(handle=candidate).exists():
            n += 1
            candidate = f"{root}{n}"
        return candidate[:30]

    @property
    def is_banned(self) -> bool:
        return self.banned_at is not None

    @property
    def is_admin(self) -> bool:
        return self.role == self.Role.ADMIN or self.is_superuser


class AuthAccount(models.Model):
    """A linked OAuth identity (google / discord / apple)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="auth_accounts")
    provider = models.CharField(max_length=32)
    provider_account_id = models.CharField(max_length=191)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        unique_together = [("provider", "provider_account_id")]


class LoginToken(models.Model):
    """Single-use, hashed token backing magic-link, email-verify and reset flows."""

    class Purpose(models.TextChoices):
        SIGNUP = "signup"
        LOGIN = "login"
        VERIFY = "verify"
        RESET = "reset"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField()
    user = models.ForeignKey(User, on_delete=models.CASCADE, null=True, blank=True,
                             related_name="login_tokens")
    purpose = models.CharField(max_length=16, choices=Purpose.choices)
    token_hash = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        indexes = [models.Index(fields=["email", "purpose"])]

    @classmethod
    def issue(cls, email: str, purpose: str, user: "User | None" = None,
              ttl_minutes: int = 30) -> tuple["LoginToken", str]:
        raw = secrets.token_urlsafe(32)
        token = cls.objects.create(
            email=email.lower(),
            user=user,
            purpose=purpose,
            token_hash=_hash_token(raw),
            expires_at=timezone.now() + timedelta(minutes=ttl_minutes),
        )
        return token, raw

    @classmethod
    def redeem(cls, raw: str, purpose: str) -> "LoginToken | None":
        try:
            token = cls.objects.get(token_hash=_hash_token(raw), purpose=purpose)
        except cls.DoesNotExist:
            return None
        if token.used_at is not None or token.expires_at < timezone.now():
            return None
        token.used_at = timezone.now()
        token.save(update_fields=["used_at"])
        return token
