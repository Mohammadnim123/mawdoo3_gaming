from __future__ import annotations

import os

from django.conf import settings

from .i18n import strings

# Deterministic avatar hue — mirrors the vendored @codply/ui Avatar exactly
# (frontend/src/vendor/codply-ui/primitives/Avatar.tsx): JS
# `hash = (hash * 31 + ch.charCodeAt(0)) | 0` over the name, then
# `AVATAR_HUES[abs(hash) % 8]`. Order matters — do not reshuffle.
AVATAR_HUES = [
    "var(--color-violet)",
    "var(--color-cyan)",
    "var(--color-success)",
    "var(--color-warning)",
    "var(--color-danger)",
    "var(--color-info)",
    "var(--color-lime)",
    "var(--color-orange)",
]


def _avatar_hue(name: str) -> str:
    h = 0
    for ch in name:
        code = ord(ch)
        if code > 0xFFFF:
            # JS iterates code points but reads charCodeAt(0) — the high surrogate.
            code = 0xD800 + ((code - 0x10000) >> 10)
        h = (h * 31 + code) & 0xFFFFFFFF
        if h >= 0x80000000:  # JS `| 0` → signed 32-bit
            h -= 0x100000000
    return AVATAR_HUES[abs(h) % len(AVATAR_HUES)]


def _avatar_initials(name: str) -> str:
    parts = [p for p in name.strip().split() if p]
    first = parts[0][0] if parts else "?"
    second = parts[-1][0] if len(parts) > 1 else ""
    return (first + second).upper()


def _avatar_context(user) -> dict:
    """SSR twin of the React <Avatar size='sm'> the account menu renders."""
    name = user.display_name or user.handle
    hue = _avatar_hue(name)
    return {
        "name": name,
        "initials": _avatar_initials(name),
        "src": user.avatar_url or "",
        "hue": hue,
        "bg": f"color-mix(in srgb, {hue} 15%, transparent)",
        "border": f"color-mix(in srgb, {hue} 35%, transparent)",
    }


def _active_tab(path: str) -> str:
    """Mobile tab bar active state — the reference MobileTabBar matchers."""
    if path == "/" or path.startswith("/feed"):
        return "home"
    if path.startswith("/studio") or path.startswith("/create"):
        return "create"
    if path.startswith("/notifications"):
        return "alerts"
    if path.startswith("/me") or path.startswith("/u/"):
        return "me"
    return ""


def chrome(request):
    """Inject locale/dir + i18n strings + nav state into every template."""
    locale = getattr(request, "locale", settings.WEB_DEFAULT_LOCALE)
    text_dir = getattr(request, "text_dir", "ltr")
    user = getattr(request, "user", None)
    t = strings(locale)

    unread = 0
    me = None
    avatar = None
    if user is not None and user.is_authenticated:
        try:
            from social.models import Notification

            unread = Notification.objects.filter(recipient=user, read=False).count()
        except Exception:
            unread = 0
        try:
            # The Me contract payload — seeds the chrome island's query cache
            # so its first React render matches the server-rendered chrome.
            from api.serializers import me_payload

            me = me_payload(user)
        except Exception:
            me = None
        avatar = _avatar_context(user)

    if unread > 0:
        bell_aria = t["nav_notifications_unread"].replace("{count}", str(unread))
    else:
        bell_aria = t["nav_notifications"]

    # Canonical origin: env-pinned in prod (reference siteOrigin()); the
    # request host is only a dev fallback so staging/proxies don't leak into
    # canonical/OG/JSON-LD identity.
    site_origin = getattr(settings, "SITE_ORIGIN", "") or (
        f"{request.scheme}://{request.get_host()}" if hasattr(request, "get_host") else ""
    )

    return {
        "locale": locale,
        "dir": text_dir,
        "t": t,
        "other_locale": "en" if locale == "ar" else "ar",
        "site_name": settings.SITE_NAME,
        "site_origin": site_origin,
        "games_cdn_base_url": settings.GAMES_CDN_BASE_URL,
        "nav_unread": unread,
        "nav_unread_badge": "99+" if unread > 99 else str(unread),
        "nav_bell_aria": bell_aria,
        "nav_tab": _active_tab(getattr(request, "path", "/") or "/"),
        "nav_avatar": avatar,
        # Props for the chrome island (#chrome-actions) — parsed by mountIsland.
        "chrome_props": {"me": me, "unread": unread},
        # Reference footer: the Discord button only renders when configured.
        "discord_url": os.environ.get("DISCORD_URL", ""),
    }
