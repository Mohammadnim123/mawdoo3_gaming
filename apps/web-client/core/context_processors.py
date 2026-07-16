from __future__ import annotations

from django.conf import settings

from .i18n import strings


def chrome(request):
    """Inject locale/dir + i18n strings + nav state into every template."""
    locale = getattr(request, "locale", settings.WEB_DEFAULT_LOCALE)
    text_dir = getattr(request, "text_dir", "ltr")
    user = getattr(request, "user", None)

    unread = 0
    if user is not None and user.is_authenticated:
        try:
            from social.models import Notification

            unread = Notification.objects.filter(recipient=user, read=False).count()
        except Exception:
            unread = 0

    return {
        "locale": locale,
        "dir": text_dir,
        "t": strings(locale),
        "other_locale": "en" if locale == "ar" else "ar",
        "site_name": settings.SITE_NAME,
        "games_cdn_base_url": settings.GAMES_CDN_BASE_URL,
        "nav_unread": unread,
    }
