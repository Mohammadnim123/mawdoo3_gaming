from __future__ import annotations

from django.contrib import messages
from django.contrib.auth import authenticate, get_user_model, login, logout
from django.contrib.auth.decorators import login_required
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.decorators.http import require_http_methods, require_POST

from billing.services import grant_initial

from .emails import send_magic_link, send_password_reset, send_verify_email
from .models import LoginToken

User = get_user_model()

VALID_MODES = {"login", "signup", "magic"}


def _safe_next(request, default: str = "/") -> str:
    nxt = request.POST.get("next") or request.GET.get("next") or default
    if url_has_allowed_host_and_scheme(nxt, allowed_hosts={request.get_host()},
                                       require_https=request.is_secure()):
        return nxt
    return default


def _oauth_providers() -> list[dict]:
    """Configured OAuth providers (none until credentials are wired)."""
    return []


# --------------------------------------------------------------------------
# Login / signup / magic link
# --------------------------------------------------------------------------
@require_http_methods(["GET", "POST"])
def login_view(request):
    nxt = _safe_next(request)
    if request.user.is_authenticated:
        return redirect(nxt)

    mode = request.POST.get("mode") or request.GET.get("mode") or "login"
    if mode not in VALID_MODES:
        mode = "login"

    if request.method == "POST":
        email = (request.POST.get("email") or "").strip().lower()
        password = request.POST.get("password") or ""

        if mode == "magic":
            if email:
                user = User.objects.filter(email__iexact=email).first()
                _, raw = LoginToken.issue(email, LoginToken.Purpose.LOGIN, user=user)
                send_magic_link(request, email, raw)
            return render(request, "auth/check_email.html", {"email": email})

        if mode == "signup":
            if not email or len(password) < 8:
                messages.error(request, "Enter an email and a password of at least 8 characters.")
            elif User.objects.filter(email__iexact=email).exists():
                messages.error(request, "That email is already registered — try logging in.")
            else:
                user = User.objects.create_user(email=email, password=password)
                grant_initial(user)
                _, raw = LoginToken.issue(email, LoginToken.Purpose.VERIFY, user=user)
                send_verify_email(request, email, raw)
                login(request, user)
                return redirect(nxt)
        else:  # login
            user = authenticate(request, email=email, password=password)
            if user is not None:
                login(request, user)
                return redirect(nxt)
            messages.error(request, "Wrong email or password.")

    return render(request, "auth/login.html",
                  {"mode": mode, "next": nxt, "providers": _oauth_providers()})


@require_POST
def logout_view(request):
    logout(request)
    return redirect("/")


@require_http_methods(["GET"])
def verify_view(request):
    """Redeem a magic-link / email-verify / signup token → sign the user in."""
    raw = request.GET.get("token", "")
    token = None
    for purpose in (LoginToken.Purpose.LOGIN, LoginToken.Purpose.VERIFY,
                    LoginToken.Purpose.SIGNUP):
        token = LoginToken.redeem(raw, purpose)
        if token:
            break
    if not token:
        messages.error(request, "That link is invalid or has expired.")
        return redirect("/login")

    user = token.user or User.objects.filter(email__iexact=token.email).first()
    if user is None:
        messages.error(request, "That link is invalid or has expired.")
        return redirect("/login")
    if not user.email_verified:
        user.email_verified = True
        user.save(update_fields=["email_verified"])
    login(request, user)
    messages.success(request, "You're signed in.")
    return redirect(_safe_next(request))


# --------------------------------------------------------------------------
# Password reset
# --------------------------------------------------------------------------
@require_http_methods(["GET", "POST"])
def forgot_view(request):
    if request.method == "POST":
        email = (request.POST.get("email") or "").strip().lower()
        if email:
            user = User.objects.filter(email__iexact=email).first()
            _, raw = LoginToken.issue(email, LoginToken.Purpose.RESET, user=user)
            send_password_reset(request, email, raw)
        return render(request, "auth/check_email.html", {"email": email, "reset": True})
    return render(request, "auth/forgot.html")


@require_http_methods(["GET", "POST"])
def reset_view(request):
    raw = request.POST.get("token") or request.GET.get("token") or ""
    if request.method == "POST":
        password = request.POST.get("password") or ""
        token = LoginToken.redeem(raw, LoginToken.Purpose.RESET)
        if not token:
            messages.error(request, "That reset link is invalid or has expired.")
            return redirect("/login")
        if len(password) < 8:
            messages.error(request, "Password must be at least 8 characters.")
            return render(request, "auth/reset.html", {"token": raw})
        user = token.user or User.objects.filter(email__iexact=token.email).first()
        if user is None:
            messages.error(request, "That reset link is invalid or has expired.")
            return redirect("/login")
        user.set_password(password)
        user.auth_epoch += 1
        user.email_verified = True
        user.save(update_fields=["password", "auth_epoch", "email_verified"])
        login(request, user)
        messages.success(request, "Your password has been reset.")
        return redirect("/")
    return render(request, "auth/reset.html", {"token": raw})


# --------------------------------------------------------------------------
# OAuth (scaffold — provider round-trips wired when credentials exist)
# --------------------------------------------------------------------------
@require_http_methods(["GET"])
def oauth_start(request, provider: str):
    messages.error(request, "Social login isn't configured yet — use email.")
    return redirect("/login")


@require_http_methods(["GET"])
def oauth_callback(request):
    return redirect("/login")


# --------------------------------------------------------------------------
# Account + public profile
# --------------------------------------------------------------------------
@login_required(login_url="/login")
def me_view(request):
    from games.models import Game, GameStatus

    tab = request.GET.get("tab", "games")
    games = Game.objects.filter(owner=request.user).exclude(status=GameStatus.REMOVED)
    saved_ids = request.user.saves.values_list("game_id", flat=True)
    saved = Game.objects.filter(id__in=list(saved_ids)).exclude(status=GameStatus.REMOVED)
    return render(request, "account/me.html", {
        "profile_user": request.user,
        "games": games,
        "saved": saved,
        "tab": tab,
    })


@require_POST
@login_required(login_url="/login")
def me_update_view(request):
    u = request.user
    u.display_name = (request.POST.get("display_name") or u.display_name).strip()[:80]
    u.bio = (request.POST.get("bio") or "").strip()[:200]
    u.save(update_fields=["display_name", "bio"])
    messages.success(request, "Profile updated.")
    return redirect("/me")


def profile_view(request, handle: str):
    from games.models import Game, GameStatus, Visibility

    profile_user = get_object_or_404(User, handle=handle, banned_at__isnull=True)
    games = Game.objects.filter(
        owner=profile_user, status=GameStatus.LIVE, visibility=Visibility.PUBLIC,
    )
    viewer_following = False
    if request.user.is_authenticated and request.user != profile_user:
        viewer_following = request.user.following_set.filter(following=profile_user).exists()
    return render(request, "profile/detail.html", {
        "profile_user": profile_user,
        "games": games,
        "viewer_following": viewer_following,
    })
