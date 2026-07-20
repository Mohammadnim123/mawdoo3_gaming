from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

USER = settings.AUTH_USER_MODEL


class CreditLedger(models.Model):
    """Append-only credit movements. ``balance_after`` snapshots the user's
    balance for cheap history rendering; idempotency is enforced on
    (user, kind, idempotency_key)."""

    class Kind(models.TextChoices):
        GRANT_INITIAL = "grant_initial"
        GRANT_DAILY = "grant_daily"
        GRANT_PLAN_RESET = "grant_plan_reset"
        SPEND_JOB = "spend_job"
        REFUND_JOB = "refund_job"
        ADMIN_ADJUST = "admin_adjust"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(USER, on_delete=models.CASCADE, related_name="credit_ledger")
    kind = models.CharField(max_length=24, choices=Kind.choices)
    amount_cents = models.IntegerField()  # +grant / -spend
    balance_after_cents = models.IntegerField()
    job = models.ForeignKey("games.GenerationJobRef", on_delete=models.SET_NULL,
                            null=True, blank=True, related_name="+")
    idempotency_key = models.CharField(max_length=128, blank=True)
    note = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "kind", "idempotency_key"],
                condition=~models.Q(idempotency_key=""),
                name="uniq_credit_idem",
            )
        ]


class Subscription(models.Model):
    class Plan(models.TextChoices):
        FREE = "free"
        PRO = "pro"
        STUDIO = "studio"

    class Status(models.TextChoices):
        ACTIVE = "active"
        CANCELLED = "cancelled"
        PAST_DUE = "past_due"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(USER, on_delete=models.CASCADE, related_name="subscription")
    plan = models.CharField(max_length=12, choices=Plan.choices, default=Plan.FREE)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.ACTIVE)
    period_start = models.DateTimeField(null=True, blank=True)
    period_end = models.DateTimeField(null=True, blank=True)
    # Stripe linkage: customer, the active subscription, and its price. Set by
    # the payment webhook; empty on Free / never-paid accounts.
    external_customer_id = models.CharField(max_length=128, blank=True)
    external_subscription_id = models.CharField(max_length=128, blank=True)
    external_price_id = models.CharField(max_length=128, blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)


class CreatorEarning(models.Model):
    """Real-money liability accrued to a creator (kept separate from credits)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(USER, on_delete=models.CASCADE, related_name="earnings")
    amount_cents = models.IntegerField()
    source = models.CharField(max_length=40, blank=True)
    game = models.ForeignKey("games.Game", on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]


class PayoutRequest(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending"
        PAID = "paid"
        REJECTED = "rejected"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(USER, on_delete=models.CASCADE, related_name="payout_requests")
    amount_cents = models.IntegerField()
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(default=timezone.now)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["user"], condition=models.Q(status="pending"),
                name="uniq_pending_payout_per_user",
            )
        ]
