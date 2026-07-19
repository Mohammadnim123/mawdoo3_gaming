from __future__ import annotations

import logging

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.db.models import Sum
from django.shortcuts import redirect, render
from django.views.decorators.http import require_POST
from games.models import GameStatus

from . import services, stripe_gateway

logger = logging.getLogger(__name__)


def billing(request):
    # Anonymous visitors get the screen's own logged-out state (reference
    # parity: /account/* is outside the auth-gate matcher; BillingScreen
    # renders an EmptyState + login link). The island self-fetches everything.
    return render(request, "billing/billing.html", {})


@require_POST
@login_required(login_url="/login")
def claim_daily(request):
    services.grant_daily(request.user)
    messages.success(request, "Daily credits claimed.")
    return redirect("/account/billing")


@require_POST
@login_required(login_url="/login")
def checkout(request):
    """Non-JS fallback for the upgrade button: hand off to Stripe Checkout.

    There is deliberately no free upgrade here — the plan is only activated by
    the Stripe webhook after payment. If Stripe isn't configured, we say so
    instead of granting Pro."""
    if not stripe_gateway.is_enabled():
        messages.error(request, "Online checkout isn't available yet.")
        return redirect("/account/billing")
    interval = request.POST.get("interval") or "monthly"
    base = request.build_absolute_uri("/").rstrip("/")
    try:
        session = stripe_gateway.create_checkout_session(
            user=request.user, plan="pro", interval=interval,
            success_url=f"{base}/account/billing?checkout=success",
            cancel_url=f"{base}/account/billing?checkout=cancelled",
        )
    except Exception:
        logger.exception("legacy checkout: stripe session creation failed")
        messages.error(request, "Couldn't start checkout. Please try again.")
        return redirect("/account/billing")
    return redirect(session.url)


@login_required(login_url="/login")
def dashboard(request):
    games = list(request.user.games.exclude(status=GameStatus.REMOVED).order_by("-created_at"))
    agg = request.user.games.aggregate(
        plays=Sum("play_count"), likes=Sum("like_count"),
        comments=Sum("comment_count"), remixes=Sum("remix_count"),
    )
    earnings = list(request.user.earnings.all()[:20])
    earned_total = request.user.earnings.aggregate(t=Sum("amount_cents")).get("t") or 0
    payouts = list(request.user.payout_requests.all()[:10])
    return render(request, "billing/dashboard.html", {
        "games": games,
        "totals": {
            "games": len(games),
            "plays": agg.get("plays") or 0,
            "likes": agg.get("likes") or 0,
            "comments": agg.get("comments") or 0,
            "remixes": agg.get("remixes") or 0,
        },
        "earnings": earnings,
        "earned_total": earned_total,
        "payouts": payouts,
    })


def settings_view(request):
    """Device-level prefs (theme/language) — works logged-out, like the
    reference. The legacy profile-edit POST stays for form fallbacks only."""
    if request.method == "POST":
        if not request.user.is_authenticated:
            return redirect("/login?next=/account/settings")
        u = request.user
        u.display_name = (request.POST.get("display_name") or u.display_name).strip()[:80]
        u.bio = (request.POST.get("bio") or "").strip()[:200]
        u.save(update_fields=["display_name", "bio"])
        messages.success(request, "Saved.")
        return redirect("/account/settings")
    return render(request, "billing/settings.html", {})
