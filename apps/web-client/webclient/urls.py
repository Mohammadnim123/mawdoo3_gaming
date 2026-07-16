from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    # SEO + legal + status (robots.txt, sitemap.xml, /privacy, /terms, /status).
    path("", include("core.urls")),
    # Accounts (login/signup/logout, magic-link, reset, /me, /u/<handle>).
    path("", include("accounts.urls")),
    # Social engagement (like/save/share/comments/follow, notifications, search).
    path("", include("social.urls")),
    # Billing, credits, dashboard, settings.
    path("", include("billing.urls")),
    # Games: landing/feed, create, studio, game pages.
    path("", include("games.urls")),
]
