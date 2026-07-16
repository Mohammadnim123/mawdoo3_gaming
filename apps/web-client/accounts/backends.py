from __future__ import annotations

from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend


class EmailBackend(ModelBackend):
    """Authenticate by email (case-insensitive) + password, blocking banned users."""

    def authenticate(self, request, username=None, password=None, email=None, **kwargs):
        User = get_user_model()
        identifier = email or username
        if not identifier or password is None:
            return None
        try:
            user = User.objects.get(email__iexact=identifier)
        except User.DoesNotExist:
            # Run the hasher once to keep timing uniform for unknown emails.
            User().set_password(password)
            return None
        if user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None

    def user_can_authenticate(self, user) -> bool:
        return super().user_can_authenticate(user) and getattr(user, "banned_at", None) is None
