from __future__ import annotations

from django.conf import settings

RTL_LOCALES = {"ar"}
SUPPORTED = {"ar", "en"}


class LocaleMiddleware:
    """Resolve the active locale (EN/AR) per request from ?lang / cookie / default,
    expose it as ``request.locale`` + ``request.text_dir``, and persist an explicit
    ?lang choice back to the cookie so the whole app (server + islands) agrees.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        chosen = request.GET.get("lang")
        cookie = request.COOKIES.get(settings.LOCALE_COOKIE_NAME)
        locale = next(
            (v for v in (chosen, cookie, settings.WEB_DEFAULT_LOCALE) if v in SUPPORTED),
            "en",
        )
        request.locale = locale
        request.text_dir = "rtl" if locale in RTL_LOCALES else "ltr"

        response = self.get_response(request)

        if chosen in SUPPORTED and chosen != cookie:
            response.set_cookie(
                settings.LOCALE_COOKIE_NAME, chosen,
                max_age=60 * 60 * 24 * 365, samesite="Lax",
                secure=not settings.DEBUG,
            )
        return response


class EnsureCsrfCookieMiddleware:
    """Set the csrftoken cookie on every HTML page response.

    The React islands call the /api/v1 contract with an X-CSRFToken header
    read from this cookie; without it a fresh session's first mutation would
    403. Calling get_token() marks the cookie for sending.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        from django.middleware.csrf import get_token

        if request.method == "GET" and not request.path.startswith(
            ("/api/", "/static/", "/media/")
        ):
            get_token(request)
        return self.get_response(request)
