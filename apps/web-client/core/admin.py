from __future__ import annotations

from django.contrib import admin

from .models import AuditLog, FeatureFlag


@admin.register(FeatureFlag)
class FeatureFlagAdmin(admin.ModelAdmin):
    list_display = ["key", "enabled", "description", "updated_at"]
    list_editable = ["enabled"]


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ["action", "target", "actor", "created_at"]
    list_filter = ["action"]
    search_fields = ["target", "action"]
    readonly_fields = ["id", "actor", "action", "target", "meta", "created_at"]
