from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    # Contract JSON API consumed by the React islands (/api/v1/*).
    path("", include("api.urls")),
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

if settings.DEBUG:
    # Avatar uploads and other user media (a real server fronts this in prod).
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
