"""Contract auth endpoints — Django session-cookie backed.

The reference API returns bearer tokens which its BFF stores in an httpOnly
cookie. Here Django IS the session layer, so `login()` sets the cookie
directly and `token` is a constant marker the client never needs to use.
The response SHAPES still match `AuthTokenResponse` exactly so the ported
screens work verbatim.
"""

from __future__ import annotations

from accounts.emails import send_magic_link, send_password_reset, send_verify_email
from accounts.models import LoginToken
from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout

from .http import (
    UNAUTHORIZED,
    VALIDATION_ERROR,
    ApiError,
    api_view,
    json_body,
    no_content,
)
from .serializers import user_payload

SESSION_TOKEN = "session"


def _auth_response(request, user) -> dict:
    login(request, user, backend="accounts.backends.EmailBackend")
    return {"token": SESSION_TOKEN, "user": user_payload(user)}


def _oauth_providers() -> list[str]:
    """Canonical order (google, discord, apple); only configured ones."""
    configured = []
    for provider in ("google", "discord", "apple"):
        if getattr(settings, f"OAUTH_{provider.upper()}_CLIENT_ID", ""):
            configured.append(provider)
    return configured


@api_view("GET")
def providers(request):
    from django.http import JsonResponse

    return JsonResponse({"password": True, "providers": _oauth_providers()})


@api_view("POST")
def signup(request):
    """Enumeration-safe: always answers {"status": "sent"}."""
    from django.http import JsonResponse

    body = json_body(request)
    email = str(body.get("email") or "").strip().lower()
    password = str(body.get("password") or "")
    if "@" not in email or not (8 <= len(password) <= 128):
        raise ApiError(VALIDATION_ERROR, "Enter a valid email and a password of 8+ characters.")

    User = get_user_model()
    if not User.objects.filter(email=email).exists():
        user = User.objects.create_user(email=email, password=password)
        from billing.services import grant_initial

        grant_initial(user)
        token, raw = LoginToken.issue(email, LoginToken.Purpose.SIGNUP, user=user,
                                      ttl_minutes=60 * 24)
        send_verify_email(request, email, raw)
    return JsonResponse({"status": "sent"})


@api_view("POST")
def login_password(request):
    from django.http import JsonResponse

    body = json_body(request)
    email = str(body.get("email") or "").strip().lower()
    password = str(body.get("password") or "")
    user = authenticate(request, username=email, password=password)
    if user is None or user.is_banned:
        raise ApiError(UNAUTHORIZED, "Invalid email or password.", status=401)
    return JsonResponse(_auth_response(request, user))


@api_view("POST")
def verify_token(request):
    """Signup-verification and magic-link tokens both land here."""
    from django.http import JsonResponse

    raw = str(json_body(request).get("token") or "")
    token = (
        LoginToken.redeem(raw, LoginToken.Purpose.SIGNUP)
        or LoginToken.redeem(raw, LoginToken.Purpose.LOGIN)
    )
    if token is None or token.user is None:
        raise ApiError(UNAUTHORIZED, "That link didn't work — request a new one.", status=401)
    user = token.user
    if token.purpose == LoginToken.Purpose.SIGNUP and not user.email_verified:
        user.email_verified = True
        user.save(update_fields=["email_verified"])
    return JsonResponse(_auth_response(request, user))


@api_view("POST")
def magic_link_request(request):
    from django.http import JsonResponse

    email = str(json_body(request).get("email") or "").strip().lower()
    if "@" not in email:
        raise ApiError(VALIDATION_ERROR, "Enter a valid email.")
    User = get_user_model()
    user = User.objects.filter(email=email).first()
    payload: dict = {}
    if user is not None and not user.is_banned:
        token, raw = LoginToken.issue(email, LoginToken.Purpose.LOGIN, user=user)
        send_magic_link(request, email, raw)
        if not getattr(settings, "EMAIL_DELIVERY_CONFIGURED", False):
            # No mailer wired (dev): hand the code back inline, like the
            # reference's v0.1 inline mode.
            payload["code"] = raw
    return JsonResponse(payload)


@api_view("POST")
def magic_link_verify(request):
    from django.http import JsonResponse

    raw = str(json_body(request).get("token") or "")
    token = LoginToken.redeem(raw, LoginToken.Purpose.LOGIN)
    if token is None or token.user is None:
        raise ApiError(UNAUTHORIZED, "That code didn't work — request a new one.", status=401)
    return JsonResponse(_auth_response(request, token.user))


@api_view("POST")
def password_forgot(request):
    from django.http import JsonResponse

    email = str(json_body(request).get("email") or "").strip().lower()
    if "@" not in email:
        raise ApiError(VALIDATION_ERROR, "Enter a valid email.")
    User = get_user_model()
    user = User.objects.filter(email=email).first()
    if user is not None:
        token, raw = LoginToken.issue(email, LoginToken.Purpose.RESET, user=user)
        send_password_reset(request, email, raw)
    return JsonResponse({"status": "sent"})


@api_view("POST")
def password_reset(request):
    from django.http import JsonResponse

    body = json_body(request)
    raw = str(body.get("token") or "")
    password = str(body.get("password") or "")
    if not (8 <= len(password) <= 128):
        raise ApiError(VALIDATION_ERROR, "Passwords need 8+ characters.")
    token = LoginToken.redeem(raw, LoginToken.Purpose.RESET)
    if token is None or token.user is None:
        raise ApiError(UNAUTHORIZED, "This reset link is missing, expired or already used.",
                       status=401)
    user = token.user
    user.set_password(password)
    user.auth_epoch += 1  # invalidate outstanding links
    user.save(update_fields=["password", "auth_epoch"])
    return JsonResponse(_auth_response(request, user))


@api_view("POST")
def oauth_complete(request):
    raise ApiError(VALIDATION_ERROR, "OAuth isn't configured on this deployment.")


@api_view("GET")
def oauth_start(request, provider: str):
    """302 to the provider. Stubbed until real client ids are configured."""
    from django.shortcuts import redirect

    return redirect("/login?error=oauth")


@api_view("POST", "DELETE")
def session(request):
    """BFF session shim: the reference posts its bearer token here to set the
    httpOnly cookie. Django's session cookie is already set by login() — this
    endpoint only needs to exist (and clear the session on DELETE/logout)."""
    if request.method == "DELETE":
        logout(request)
    return no_content()
