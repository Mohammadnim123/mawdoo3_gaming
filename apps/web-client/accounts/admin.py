from __future__ import annotations

from django.contrib import admin

from .models import AuthAccount, LoginToken, User


@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    ordering = ["-created_at"]
    list_display = ["handle", "email", "role", "credits_balance_cents", "is_staff",
                    "banned_at", "created_at"]
    list_filter = ["role", "is_staff", "is_superuser", "email_verified"]
    search_fields = ["email", "handle", "display_name"]
    readonly_fields = ["id", "created_at", "last_login", "password"]
    filter_horizontal = ["groups", "user_permissions"]


@admin.register(AuthAccount)
class AuthAccountAdmin(admin.ModelAdmin):
    list_display = ["provider", "provider_account_id", "user", "created_at"]
    search_fields = ["provider_account_id", "user__email"]


@admin.register(LoginToken)
class LoginTokenAdmin(admin.ModelAdmin):
    list_display = ["email", "purpose", "expires_at", "used_at", "created_at"]
    list_filter = ["purpose"]
    search_fields = ["email"]
