from __future__ import annotations

from django.urls import path

from . import views

urlpatterns = [
    path("login", views.login_view, name="login"),
    path("logout", views.logout_view, name="logout"),
    path("auth/magic-link", views.login_view, name="magic_link"),  # posts mode=magic
    path("auth/verify", views.verify_view, name="verify"),
    path("forgot-password", views.forgot_view, name="forgot_password"),
    path("reset-password", views.reset_view, name="reset_password"),
    # Legacy URL shapes → the reference shapes above.
    path("auth/forgot", views.forgot_redirect, name="forgot_legacy"),
    path("auth/reset/<str:token>", views.reset_redirect, name="reset_legacy"),
    path("auth/oauth/<slug:provider>/start", views.oauth_start, name="oauth_start"),
    path("auth/callback", views.oauth_callback, name="oauth_callback"),
    path("me", views.me_view, name="me"),
    path("me/update", views.me_update_view, name="me_update"),
    path("u/<slug:handle>", views.profile_view, name="profile"),
]
