"""The /api/v1 contract surface (see frontend/src/vendor/contracts/API.md)."""

from __future__ import annotations

from django.urls import path

from . import views_auth, views_billing, views_games, views_jobs, views_me, views_social

urlpatterns = [
    # -- session shim (BFF parity) -------------------------------------------
    path("api/session", views_auth.session),
    # useJobStream fetches the reference BFF's un-versioned stream path
    # directly (the only raw fetch besides /api/session) — alias it.
    path("api/jobs/<uuid:job_id>/stream", views_jobs.stream),
    # -- auth ------------------------------------------------------------------
    path("api/v1/auth/providers", views_auth.providers),
    path("api/v1/auth/signup", views_auth.signup),
    path("api/v1/auth/login", views_auth.login_password),
    path("api/v1/auth/verify", views_auth.verify_token),
    path("api/v1/auth/magic-link/request", views_auth.magic_link_request),
    path("api/v1/auth/magic-link/verify", views_auth.magic_link_verify),
    path("api/v1/auth/password/forgot", views_auth.password_forgot),
    path("api/v1/auth/password/reset", views_auth.password_reset),
    path("api/v1/auth/oauth/complete", views_auth.oauth_complete),
    path("api/v1/auth/oauth/<str:provider>/start", views_auth.oauth_start),
    # -- jobs -------------------------------------------------------------------
    path("api/v1/generate", views_jobs.generate),
    path("api/v1/jobs/<uuid:job_id>", views_jobs.snapshot),
    path("api/v1/jobs/<uuid:job_id>/stream", views_jobs.stream),
    path("api/v1/jobs/<uuid:job_id>/answers", views_jobs.answers),
    path("api/v1/jobs/<uuid:job_id>/cancel", views_jobs.cancel),
    path("api/v1/jobs/<uuid:job_id>/draft", views_jobs.draft),
    # -- me ---------------------------------------------------------------------
    path("api/v1/me", views_me.me),
    path("api/v1/me/avatar", views_me.avatar),
    path("api/v1/me/games", views_me.my_games),
    path("api/v1/me/games/<uuid:game_id>", views_me.my_game_detail),
    path("api/v1/me/assets", views_me.my_assets),
    path("api/v1/me/saves", views_me.my_saves),
    path("api/v1/me/likes", views_me.my_likes),
    path("api/v1/me/history", views_me.my_history),
    path("api/v1/me/notifications", views_me.notifications),
    path("api/v1/me/notifications/unread_count", views_me.unread_count),
    path("api/v1/me/notifications/read", views_me.mark_notifications_read),
    path("api/v1/me/credits", views_me.credits),
    path("api/v1/me/credits/claim-daily", views_me.claim_daily),
    path("api/v1/me/subscription", views_me.subscription),
    path("api/v1/me/subscription/checkout", views_me.checkout),
    # -- billing (Stripe webhook; signature-verified, no session/CSRF) ----------
    path("api/v1/billing/stripe/webhook", views_billing.stripe_webhook),
    path("api/v1/me/creator/overview", views_me.creator_overview),
    path("api/v1/me/creator/payouts", views_me.payouts),
    # -- games ------------------------------------------------------------------
    path("api/v1/games", views_games.feed),
    path("api/v1/games/<str:handle>", views_games.game_resource),
    path("api/v1/games/<str:handle>/versions", views_games.versions),
    path("api/v1/games/<str:handle>/versions/<uuid:version_id>/source",
         views_games.version_source),
    path("api/v1/games/<str:handle>/versions/<uuid:version_id>/files",
         views_games.version_files),
    path("api/v1/games/<str:handle>/source", views_games.save_source),
    path("api/v1/games/<str:handle>/rollback", views_games.rollback),
    path("api/v1/games/<str:handle>/session/reset", views_games.session_reset),
    path("api/v1/games/<str:handle>/play", views_games.play),
    path("api/v1/games/<str:handle>/report", views_games.report),
    path("api/v1/games/<str:handle>/like", views_games.like),
    path("api/v1/games/<str:handle>/save", views_games.save_game),
    path("api/v1/games/<str:handle>/share", views_games.share),
    path("api/v1/games/<str:handle>/chat", views_games.chat),
    path("api/v1/games/<str:handle>/remix", views_games.remix),
    path("api/v1/games/<str:handle>/screenshot", views_games.screenshot),
    path("api/v1/games/<str:handle>/comments", views_social.comments),
    # -- comments ----------------------------------------------------------------
    path("api/v1/comments/<uuid:comment_id>", views_social.comment_detail),
    path("api/v1/comments/<uuid:comment_id>/history", views_social.comment_history),
    path("api/v1/comments/<uuid:comment_id>/like", views_social.comment_like),
    # -- users --------------------------------------------------------------------
    path("api/v1/users/suggested", views_social.suggested_creators),
    path("api/v1/users/<str:handle>", views_social.profile),
    path("api/v1/users/<str:handle>/games", views_social.profile_games),
    path("api/v1/users/<str:handle>/followers", views_social.followers),
    path("api/v1/users/<str:handle>/following", views_social.following),
    path("api/v1/users/<str:handle>/follow", views_social.follow),
]
