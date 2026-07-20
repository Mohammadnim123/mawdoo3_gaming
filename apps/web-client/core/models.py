from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone


class FeatureFlag(models.Model):
    """Simple runtime flag; read via ``FeatureFlag.enabled_for(key)``."""

    key = models.CharField(max_length=64, primary_key=True)
    enabled = models.BooleanField(default=False)
    description = models.CharField(max_length=200, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"{self.key}={'on' if self.enabled else 'off'}"

    @classmethod
    def enabled_for(cls, key: str, default: bool = False) -> bool:
        try:
            return cls.objects.get(pk=key).enabled
        except cls.DoesNotExist:
            return default


class AuditLog(models.Model):
    """Append-only record of moderation / admin actions."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                              null=True, blank=True, related_name="audit_actions")
    action = models.CharField(max_length=64)
    target = models.CharField(max_length=191, blank=True)
    meta = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]
