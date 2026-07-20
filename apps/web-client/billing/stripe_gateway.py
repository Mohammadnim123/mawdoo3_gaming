"""All raw Stripe I/O for self-serve Pro subscriptions lives here.

Design: entitlement (upgrading a user to Pro, granting credits) is applied
**only** from the signature-verified webhook — never on the browser's return to
``success_url``, which any signed-in user can reach without paying. The checkout
endpoint merely mints a Stripe-hosted Checkout Session and hands back its URL.

Nothing here mutates our own models; that is delegated to :mod:`billing.services`
so the entitlement rules have a single home. Keep this module a thin, testable
seam over the Stripe SDK.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from django.conf import settings

logger = logging.getLogger(__name__)


class StripeConfigError(RuntimeError):
    """Raised when a Stripe call is attempted without the required config."""


class WebhookPayloadError(Exception):
    """The webhook body could not be parsed."""


class WebhookSignatureError(Exception):
    """The webhook signature did not verify against STRIPE_WEBHOOK_SECRET."""


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

def is_enabled() -> bool:
    """Self-serve checkout is live only when a secret key and the Pro monthly
    price are configured. Otherwise the UI hides checkout instead of faking an
    upgrade (``checkout_available=false``)."""
    return bool(settings.STRIPE_SECRET_KEY and settings.STRIPE_PRICE_PRO_MONTHLY)


def _client():
    if not settings.STRIPE_SECRET_KEY:
        raise StripeConfigError("STRIPE_SECRET_KEY is not configured.")
    import stripe

    stripe.api_key = settings.STRIPE_SECRET_KEY
    return stripe


def price_id_for(plan: str, interval: str) -> str | None:
    if plan != "pro":
        return None
    if interval == "yearly":
        return settings.STRIPE_PRICE_PRO_YEARLY or None
    return settings.STRIPE_PRICE_PRO_MONTHLY or None


def plan_for_price(price_id: str) -> tuple[str, str] | None:
    """Reverse-map a Stripe price id back to (plan, interval)."""
    table = {
        settings.STRIPE_PRICE_PRO_MONTHLY: ("pro", "monthly"),
        settings.STRIPE_PRICE_PRO_YEARLY: ("pro", "yearly"),
    }
    table.pop("", None)
    return table.get(price_id)


# ---------------------------------------------------------------------------
# Checkout
# ---------------------------------------------------------------------------

def create_checkout_session(*, user, plan: str, interval: str,
                            success_url: str, cancel_url: str):
    """Create a subscription-mode Checkout Session for ``user`` and return it.

    ``client_reference_id`` and subscription metadata carry our user id so the
    webhook can attribute the payment back to the right account.
    """
    stripe = _client()
    price_id = price_id_for(plan, interval)
    if not price_id:
        raise StripeConfigError(
            f"No Stripe price configured for plan={plan!r} interval={interval!r}."
        )
    params: dict = {
        "mode": "subscription",
        "line_items": [{"price": price_id, "quantity": 1}],
        "success_url": success_url,
        "cancel_url": cancel_url,
        "client_reference_id": str(user.id),
        "metadata": {"user_id": str(user.id), "plan": plan, "interval": interval},
        "subscription_data": {"metadata": {"user_id": str(user.id), "plan": plan}},
        "allow_promotion_codes": True,
    }
    sub = getattr(user, "subscription", None)
    customer_id = getattr(sub, "external_customer_id", "") if sub else ""
    if customer_id:
        params["customer"] = customer_id
    elif user.email:
        params["customer_email"] = user.email
    return stripe.checkout.Session.create(**params)


def retrieve_subscription(subscription_id: str):
    stripe = _client()
    return stripe.Subscription.retrieve(subscription_id)


# ---------------------------------------------------------------------------
# Webhook: verification + dispatch
# ---------------------------------------------------------------------------

def construct_event(payload: bytes, sig_header: str):
    """Verify a webhook payload and return the Stripe event.

    Raises :class:`WebhookPayloadError` for an unparseable body and
    :class:`WebhookSignatureError` when the signature does not verify.
    """
    stripe = _client()
    if not settings.STRIPE_WEBHOOK_SECRET:
        raise StripeConfigError("STRIPE_WEBHOOK_SECRET is not configured.")
    try:
        return stripe.Webhook.construct_event(
            payload, sig_header, settings.STRIPE_WEBHOOK_SECRET
        )
    except ValueError as exc:
        raise WebhookPayloadError(str(exc)) from exc
    except stripe.error.SignatureVerificationError as exc:
        raise WebhookSignatureError(str(exc)) from exc


def handle_event(event) -> None:
    """Apply a verified Stripe event to our entitlement state (idempotent)."""
    from . import services

    etype = event["type"]
    obj = event["data"]["object"]
    if etype == "checkout.session.completed":
        _on_checkout_completed(obj, services)
    elif etype in ("invoice.paid", "invoice.payment_succeeded"):
        _on_invoice_paid(obj, services)
    elif etype == "invoice.payment_failed":
        _on_payment_failed(obj, services)
    elif etype == "customer.subscription.updated":
        _on_subscription_updated(obj, services)
    elif etype == "customer.subscription.deleted":
        _on_subscription_deleted(obj, services)
    else:
        logger.info("stripe webhook: ignoring event type %s", etype)


# ---------------------------------------------------------------------------
# Event handlers
# ---------------------------------------------------------------------------

def _on_checkout_completed(session, services) -> None:
    meta = session.get("metadata") or {}
    user = _resolve_user(
        user_id=session.get("client_reference_id") or meta.get("user_id"),
        customer_id=session.get("customer"),
        subscription_id=session.get("subscription"),
    )
    subscription_id = session.get("subscription")
    if user is None or not subscription_id:
        logger.warning("stripe webhook: unresolved checkout.session (sub=%s)",
                       subscription_id)
        return
    sub_obj = retrieve_subscription(subscription_id)
    _activate_from_subscription(user, sub_obj, session.get("customer"), services)


def _on_invoice_paid(invoice, services) -> None:
    subscription_id = invoice.get("subscription")
    if not subscription_id:
        return  # not a subscription invoice — nothing to entitle
    meta = invoice.get("metadata") or {}
    user = _resolve_user(
        user_id=meta.get("user_id"),
        subscription_id=subscription_id,
        customer_id=invoice.get("customer"),
    )
    if user is None:
        logger.warning("stripe webhook: unresolved invoice.paid (sub=%s)", subscription_id)
        return
    sub_obj = retrieve_subscription(subscription_id)
    _activate_from_subscription(user, sub_obj, invoice.get("customer"), services)


def _on_payment_failed(invoice, services) -> None:
    user = _resolve_user(
        subscription_id=invoice.get("subscription"),
        customer_id=invoice.get("customer"),
    )
    if user is not None:
        services.mark_past_due(user)


def _on_subscription_updated(sub_obj, services) -> None:
    meta = sub_obj.get("metadata") or {}
    user = _resolve_user(
        user_id=meta.get("user_id"),
        subscription_id=sub_obj.get("id"),
        customer_id=sub_obj.get("customer"),
    )
    if user is None:
        return
    status = sub_obj.get("status")
    if status in ("active", "trialing"):
        _activate_from_subscription(user, sub_obj, sub_obj.get("customer"), services)
    elif status in ("past_due", "unpaid"):
        services.mark_past_due(user)
    elif status in ("canceled", "incomplete_expired"):
        services.downgrade_to_free(user)


def _on_subscription_deleted(sub_obj, services) -> None:
    meta = sub_obj.get("metadata") or {}
    user = _resolve_user(
        user_id=meta.get("user_id"),
        subscription_id=sub_obj.get("id"),
        customer_id=sub_obj.get("customer"),
    )
    if user is not None:
        services.downgrade_to_free(user)


def _activate_from_subscription(user, sub_obj, customer_id, services) -> None:
    price_id, period_start, period_end = _read_subscription(sub_obj)
    mapping = plan_for_price(price_id) if price_id else None
    if mapping is None:
        logger.warning("stripe webhook: price %s is not a known plan; skipping", price_id)
        return
    services.activate_pro(
        user,
        subscription_id=str(sub_obj.get("id") or ""),
        customer_id=str(customer_id or sub_obj.get("customer") or ""),
        price_id=price_id,
        period_start=period_start,
        period_end=period_end,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _resolve_user(*, user_id=None, customer_id=None, subscription_id=None):
    """Best-effort match a Stripe object back to one of our users."""
    from django.contrib.auth import get_user_model

    from .models import Subscription

    User = get_user_model()
    if user_id:
        user = User.objects.filter(id=user_id).first()
        if user is not None:
            return user
    if subscription_id:
        sub = (Subscription.objects.filter(external_subscription_id=subscription_id)
               .select_related("user").first())
        if sub is not None:
            return sub.user
    if customer_id:
        sub = (Subscription.objects.filter(external_customer_id=customer_id)
               .select_related("user").first())
        if sub is not None:
            return sub.user
    return None


def _read_subscription(sub_obj) -> tuple[str, datetime | None, datetime | None]:
    """Pull (price_id, period_start, period_end) from a Subscription object,
    tolerating both the top-level and per-item placement of the period fields
    across Stripe API versions."""
    items = (sub_obj.get("items") or {}).get("data") or []
    price_id = ""
    period_start = period_end = None
    if items:
        item = items[0]
        price = item.get("price") or {}
        price_id = price.get("id") or ""
        period_start = _dt(item.get("current_period_start"))
        period_end = _dt(item.get("current_period_end"))
    period_start = period_start or _dt(sub_obj.get("current_period_start"))
    period_end = period_end or _dt(sub_obj.get("current_period_end"))
    return price_id, period_start, period_end


def _dt(epoch) -> datetime | None:
    if not epoch:
        return None
    return datetime.fromtimestamp(int(epoch), tz=UTC)
