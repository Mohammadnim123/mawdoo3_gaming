from __future__ import annotations

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from .models import CreditLedger


def grant(user, kind: str, amount_cents: int, *, note: str = "",
          idempotency_key: str = "", job=None) -> int:
    """Apply a credit movement atomically and append a ledger row.

    Returns the new balance. Idempotency: if ``idempotency_key`` is set and a
    row already exists for (user, kind, key), this is a no-op returning the
    current balance.
    """
    UserModel = get_user_model()
    with transaction.atomic():
        u = UserModel.objects.select_for_update().get(pk=user.pk)
        if idempotency_key and CreditLedger.objects.filter(
            user=u, kind=kind, idempotency_key=idempotency_key
        ).exists():
            return u.credits_balance_cents
        new_balance = u.credits_balance_cents + amount_cents
        u.credits_balance_cents = new_balance
        u.save(update_fields=["credits_balance_cents"])
        CreditLedger.objects.create(
            user=u, kind=kind, amount_cents=amount_cents,
            balance_after_cents=new_balance, note=note,
            idempotency_key=idempotency_key, job=job,
        )
    return new_balance


def grant_initial(user) -> int:
    return grant(
        user, CreditLedger.Kind.GRANT_INITIAL,
        settings.INITIAL_FREE_CREDITS_CENTS,
        note="Welcome credits", idempotency_key="initial",
    )


def grant_daily(user) -> int:
    """Grant the daily free credits once per calendar day (idempotent)."""
    today = timezone.now().date().isoformat()
    return grant(
        user, CreditLedger.Kind.GRANT_DAILY,
        getattr(settings, "DAILY_CREDITS_CENTS", 100),
        note="Daily credits", idempotency_key=f"daily:{today}",
    )


def generations_today(user) -> int:
    from games.models import GenerationJobRef, JobType

    start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
    return GenerationJobRef.objects.filter(
        user=user, created_at__gte=start,
        type__in=[JobType.CREATE, JobType.REMIX],
    ).count()


def can_generate(user) -> bool:
    """Daily generation quota gate (new games/remixes per day)."""
    return generations_today(user) < user.daily_gen_quota

