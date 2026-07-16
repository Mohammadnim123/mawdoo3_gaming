from __future__ import annotations

from django.contrib import admin

from .models import Game, GameVersion, GenerationJobRef


class GameVersionInline(admin.TabularInline):
    model = GameVersion
    fk_name = "game"
    extra = 0
    fields = ["version_no", "change_summary", "play_url", "created_at"]
    readonly_fields = fields


@admin.register(Game)
class GameAdmin(admin.ModelAdmin):
    list_display = ["slug", "title_en", "owner", "status", "visibility",
                    "play_count", "like_count", "created_at"]
    list_filter = ["status", "visibility", "genre"]
    search_fields = ["slug", "title_en", "title_ar", "owner__handle", "service_game_id"]
    raw_id_fields = ["owner", "current_version", "remixed_from"]
    readonly_fields = ["id", "service_game_id", "created_at", "updated_at"]
    inlines = [GameVersionInline]


@admin.register(GameVersion)
class GameVersionAdmin(admin.ModelAdmin):
    list_display = ["game", "version_no", "change_summary", "created_at"]
    raw_id_fields = ["game", "parent"]
    readonly_fields = ["id", "created_at"]


@admin.register(GenerationJobRef)
class GenerationJobRefAdmin(admin.ModelAdmin):
    list_display = ["service_job_id", "type", "status", "stage", "user", "game", "created_at"]
    list_filter = ["type", "status"]
    search_fields = ["service_job_id", "user__handle"]
    raw_id_fields = ["user", "game"]
    readonly_fields = ["id", "created_at", "updated_at"]
