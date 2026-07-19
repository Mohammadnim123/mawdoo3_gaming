from __future__ import annotations

from datetime import datetime, timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from .models import CreditLedger, Subscription


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


# ---------------------------------------------------------------------------
# Subscription entitlement — the single source of truth for what a plan grants.
# Called only from the Stripe webhook (payment already succeeded), never from
# the checkout redirect.
# ---------------------------------------------------------------------------

PRO_DAILY_GEN_QUOTA = 100


def activate_pro(user, *, subscription_id: str = "", customer_id: str = "",
                 price_id: str = "", period_start: datetime | None = None,
                 period_end: datetime | None = None,
                 credits_cents: int | None = None) -> None:
    """Upgrade ``user`` to an active Pro subscription for the paid period and
    grant the period's credits. Idempotent per (subscription, period): a
    replayed webhook re-affirms the plan but never double-grants credits."""
    now = timezone.now()
    period_start = period_start or now
    period_end = period_end or (now + timedelta(days=30))

    sub, _ = Subscription.objects.get_or_create(user=user)
    sub.plan = Subscription.Plan.PRO
    sub.status = Subscription.Status.ACTIVE
    sub.period_start = period_start
    sub.period_end = period_end
    if customer_id:
        sub.external_customer_id = customer_id
    if subscription_id:
        sub.external_subscription_id = subscription_id
    if price_id:
        sub.external_price_id = price_id
    sub.save()

    if user.daily_gen_quota < PRO_DAILY_GEN_QUOTA:
        user.daily_gen_quota = PRO_DAILY_GEN_QUOTA
        user.save(update_fields=["daily_gen_quota"])

    if credits_cents is None:
        credits_cents = getattr(settings, "PRO_PLAN_CREDITS_CENTS", 2000)
    # Key the grant to the subscription's billing period so each renewal grants
    # exactly once and webhook retries are no-ops.
    period_key = int(period_start.timestamp())
    grant(
        user, CreditLedger.Kind.GRANT_PLAN_RESET, credits_cents,
        note="Pro plan credits",
        idempotency_key=f"pro:{subscription_id or 'na'}:{period_key}",
    )


def downgrade_to_free(user, *, status: str = Subscription.Status.CANCELLED) -> None:
    """Drop ``user`` back to Free (subscription ended/cancelled). Leaves any
    remaining credit balance untouched."""
    sub, _ = Subscription.objects.get_or_create(user=user)
    sub.plan = Subscription.Plan.FREE
    sub.status = status
    sub.period_end = timezone.now()
    sub.external_subscription_id = ""
    sub.external_price_id = ""
    sub.save()


def mark_past_due(user) -> None:
    """Flag the subscription as past-due after a failed payment; Stripe keeps
    retrying and will either recover (active) or cancel it later."""
    sub, _ = Subscription.objects.get_or_create(user=user)
    sub.status = Subscription.Status.PAST_DUE
    sub.save(update_fields=["status", "updated_at"])

