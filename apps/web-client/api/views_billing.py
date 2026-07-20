"""Stripe webhook receiver.

This is the ONLY place a user is entitled to Pro. It is unauthenticated by
session (Stripe has no cookie) and CSRF-exempt — the trust comes entirely from
verifying the ``Stripe-Signature`` header against STRIPE_WEBHOOK_SECRET. A
forged or unsigned request never reaches the handler.
"""

from __future__ import annotations

import logging

from django.conf import settings
from django.http import HttpResponse, HttpResponseBadRequest
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

logger = logging.getLogger(__name__)


@csrf_exempt
@require_POST
def stripe_webhook(request):
    from billing import stripe_gateway

    if not stripe_gateway.is_enabled() or not settings.STRIPE_WEBHOOK_SECRET:
        # Nothing is wired to verify against — refuse rather than trust.
        return HttpResponse(status=503)

    payload = request.body
    sig_header = request.META.get("HTTP_STRIPE_SIGNATURE", "")
    try:
        event = stripe_gateway.construct_event(payload, sig_header)
    except stripe_gateway.WebhookPayloadError:
        return HttpResponseBadRequest("invalid payload")
    except stripe_gateway.WebhookSignatureError:
        logger.warning("stripe webhook: signature verification failed")
        return HttpResponseBadRequest("invalid signature")

    try:
        stripe_gateway.handle_event(event)
    except Exception:
        # Return 5xx so Stripe retries with backoff rather than dropping the
        # event; handlers are idempotent so a retry is safe.
        logger.exception("stripe webhook: handler failed for %s", event.get("type"))
        return HttpResponse(status=500)

    return HttpResponse(status=200)
