from __future__ import annotations

from django.conf import settings
from django.core.mail import send_mail


def _send(request, email: str, subject: str, path: str, blurb: str) -> None:
    link = request.build_absolute_uri(path)
    body = (
        f"{blurb}\n\n{link}\n\n"
        "This link expires soon. If you didn't request it, ignore this email."
    )
    send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [email], fail_silently=True)


def send_magic_link(request, email: str, raw_token: str) -> None:
    _send(request, email, "Your Codply sign-in link",
          f"/auth/verify?token={raw_token}", "Sign in to Codply:")


def send_verify_email(request, email: str, raw_token: str) -> None:
    _send(request, email, "Confirm your Codply email",
          f"/auth/verify?token={raw_token}", "Confirm your email for Codply:")


def send_password_reset(request, email: str, raw_token: str) -> None:
    _send(request, email, "Reset your Codply password",
          f"/reset-password?token={raw_token}", "Reset your Codply password:")
