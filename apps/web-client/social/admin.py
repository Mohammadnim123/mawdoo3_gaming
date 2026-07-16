from __future__ import annotations

from django.contrib import admin

from .models import (Comment, CommentLike, Follow, Like, Notification, Play,
                     Report, Save, Share)


@admin.register(Comment)
class CommentAdmin(admin.ModelAdmin):
    list_display = ["game", "user", "body", "deleted", "created_at"]
    list_filter = ["deleted"]
    search_fields = ["body", "user__handle"]
    raw_id_fields = ["game", "user", "parent"]


@admin.register(Report)
class ReportAdmin(admin.ModelAdmin):
    list_display = ["reason", "game", "comment", "reporter", "resolved", "created_at"]
    list_filter = ["resolved"]
    raw_id_fields = ["game", "comment", "reporter"]


for _m in (Play, Like, Save, Share, CommentLike, Follow, Notification):
    admin.site.register(_m)
