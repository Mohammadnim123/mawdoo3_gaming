from __future__ import annotations

from datetime import timedelta

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.db.models import Sum
from django.shortcuts import redirect, render
from django.utils import timezone
from django.views.decorators.http import require_POST
from games.models import GameStatus

from . import services
from .models import CreditLedger, Subscription


@login_required(login_url="/login")
def billing(request):
    sub = Subscription.objects.filter(user=request.user).first()
    ledger = list(request.user.credit_ledger.all()[:50])
    used_today = services.generations_today(request.user)
    return render(request, "billing/billing.html", {
        "sub": sub,
        "ledger": ledger,
        "balance_cents": request.user.credits_balance_cents,
        "used_today": used_today,
        "quota": request.user.daily_gen_quota,
        "checkout_success": request.GET.get("checkout") == "success",
    })


@require_POST
@login_required(login_url="/login")
def claim_daily(request):
    services.grant_daily(request.user)
    messages.success(request, "Daily credits claimed.")
    return redirect("/account/billing")


@require_POST
@login_required(login_url="/login")
def checkout(request):
    """Fake checkout (no payment adapter in dev): upgrade to Pro + grant credits."""
    now = timezone.now()
    sub, _ = Subscription.objects.get_or_create(user=request.user)
    sub.plan = Subscription.Plan.PRO
    sub.status = Subscription.Status.ACTIVE
    sub.period_start = now
    sub.period_end = now + timedelta(days=30)
    sub.save()
    services.grant(
        request.user, CreditLedger.Kind.GRANT_PLAN_RESET, 2000,
        note="Pro plan credits", idempotency_key=f"plan:{now.date().isoformat()}",
    )
    messages.success(request, "You're on Pro. Enjoy!")
    return redirect("/account/billing?checkout=success")


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


@login_required(login_url="/login")
def settings_view(request):
    if request.method == "POST":
        u = request.user
        u.display_name = (request.POST.get("display_name") or u.display_name).strip()[:80]
        u.bio = (request.POST.get("bio") or "").strip()[:200]
        u.save(update_fields=["display_name", "bio"])
        messages.success(request, "Saved.")
        return redirect("/account/settings")
    return render(request, "billing/settings.html", {})
