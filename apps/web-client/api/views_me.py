"""Contract /me endpoints: account, library, notifications, credits, creator."""

from __future__ import annotations

import base64
import binascii
import io
import uuid
from datetime import timedelta

from django.conf import settings
from django.http import JsonResponse
from django.utils import timezone
from games.models import Game, GameStatus
from social.models import Like, Notification, Play, Save

from .http import (
    CONFLICT,
    VALIDATION_ERROR,
    ApiError,
    api_view,
    json_body,
    no_content,
    page_params,
    paginate,
)
from .serializers import (
    feed_item,
    game_detail,
    ledger_entry,
    me_payload,
    my_game,
    notification_payload,
    payout_payload,
)


def _locale(request) -> str:
    return getattr(request, "locale", "en")


# ---------------------------------------------------------------------------
# Account
# ---------------------------------------------------------------------------

@api_view("GET", "PATCH", auth=True)
def me(request):
    user = request.user
    if request.method == "PATCH":
        body = json_body(request)
        if "display_name" in body:
            display_name = str(body.get("display_name") or "").strip()
            if not (1 <= len(display_name) <= 80):
                raise ApiError(VALIDATION_ERROR, "Display names need 1–80 characters.")
            user.display_name = display_name
        if "bio" in body:
            bio = str(body.get("bio") or "")
            if len(bio) > 200:
                raise ApiError(VALIDATION_ERROR, "Bios are capped at 200 characters.")
            user.bio = bio
        if "avatar_url" in body and body["avatar_url"] is None:
            user.avatar_url = ""
        user.save(update_fields=["display_name", "bio", "avatar_url"])
    return JsonResponse(me_payload(user))


_AVATAR_MAX_BYTES = 2 * 1024 * 1024
_AVATAR_FORMATS = {"PNG", "JPEG", "WEBP"}


@api_view("POST", auth=True)
def avatar(request):
    """Accepts {data_base64}, stores a processed WebP under MEDIA, returns Me."""
    raw = str(json_body(request).get("data_base64") or "")
    if "," in raw[:64] and raw.lstrip().startswith("data:"):
        raw = raw.split(",", 1)[1]
    try:
        blob = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError):
        raise ApiError(VALIDATION_ERROR, "That image could not be read.") from None
    if len(blob) > _AVATAR_MAX_BYTES:
        raise ApiError(VALIDATION_ERROR, "That image is too big — 2 MB max.")
    # A missing imaging library is a deployment fault, not a user error —
    # never mask it as a 422.
    from PIL import Image

    try:
        img = Image.open(io.BytesIO(blob))
        if (img.format or "").upper() not in _AVATAR_FORMATS:
            raise ApiError(VALIDATION_ERROR, "Use a PNG, JPEG or WebP image.")
        img = img.convert("RGB")
        img.thumbnail((512, 512))
        out = io.BytesIO()
        img.save(out, format="WEBP", quality=88)
    except ApiError:
        raise
    except Exception:
        raise ApiError(VALIDATION_ERROR, "That image could not be read.") from None

    from django.core.files.base import ContentFile
    from django.core.files.storage import default_storage

    name = f"avatars/{request.user.id}-{uuid.uuid4().hex[:8]}.webp"
    path = default_storage.save(name, ContentFile(out.getvalue()))
    request.user.avatar_url = f"{settings.MEDIA_URL}{path}"
    request.user.save(update_fields=["avatar_url"])
    return JsonResponse(me_payload(request.user))


# ---------------------------------------------------------------------------
# Library
# ---------------------------------------------------------------------------

@api_view("GET", auth=True)
def my_games(request):
    offset, limit = page_params(request)
    locale = _locale(request)
    qs = request.user.games.exclude(status=GameStatus.REMOVED).select_related(
        "owner", "current_version"
    ).order_by("-updated_at")
    return JsonResponse(paginate(qs, offset, limit, lambda g: my_game(g, locale)))


@api_view("GET", auth=True)
def my_game_detail(request, game_id):
    from .http import NOT_FOUND

    game = (
        Game.objects.select_related("owner", "current_version", "remixed_from")
        .exclude(status=GameStatus.REMOVED)
        .filter(id=game_id, owner=request.user)
        .first()
    )
    if game is None:
        raise ApiError(NOT_FOUND, "No such game.")
    viewer = _viewer_state(request, [game.id])
    return JsonResponse(game_detail(game, _locale(request), viewer=viewer.get(game.id)))


def _viewer_state(request, game_ids) -> dict:
    if not request.user.is_authenticated or not game_ids:
        return {}
    liked = set(Like.objects.filter(user=request.user, game_id__in=game_ids)
                .values_list("game_id", flat=True))
    saved = set(Save.objects.filter(user=request.user, game_id__in=game_ids)
                .values_list("game_id", flat=True))
    return {gid: {"liked": gid in liked, "saved": gid in saved} for gid in game_ids}


def _feed_page(request, games_qs):
    offset, limit = page_params(request)
    rows = list(games_qs[offset : offset + limit + 1])
    has_more = len(rows) > limit
    rows = rows[:limit]
    viewer = _viewer_state(request, [g.id for g in rows])
    locale = _locale(request)
    return JsonResponse({
        "items": [feed_item(g, locale, viewer=viewer.get(g.id)) for g in rows],
        "next_cursor": str(offset + limit) if has_more else None,
    })


@api_view("GET", auth=True)
def my_saves(request):
    ids = Save.objects.filter(user=request.user).values_list("game_id", flat=True)
    qs = Game.objects.filter(id__in=ids).exclude(status=GameStatus.REMOVED).select_related(
        "owner", "current_version"
    ).order_by("-created_at")
    return _feed_page(request, qs)


@api_view("GET", auth=True)
def my_likes(request):
    ids = Like.objects.filter(user=request.user).values_list("game_id", flat=True)
    qs = Game.objects.filter(id__in=ids).exclude(status=GameStatus.REMOVED).select_related(
        "owner", "current_version"
    ).order_by("-created_at")
    return _feed_page(request, qs)


@api_view("GET", auth=True)
def my_history(request):
    """Games the user recently played (distinct, newest play first)."""
    plays = (
        Play.objects.filter(user=request.user)
        .order_by("-created_at")
        .values_list("game_id", flat=True)
    )
    seen: list = []
    for gid in plays:
        if gid not in seen:
            seen.append(gid)
        if len(seen) >= 200:
            break
    games = {g.id: g for g in Game.objects.filter(id__in=seen)
             .exclude(status=GameStatus.REMOVED).select_related("owner", "current_version")}
    ordered = [games[g] for g in seen if g in games]
    return _feed_page(request, ordered)


@api_view("GET", auth=True)
def my_assets(request):
    """Generated assets across the user's games, via the engine's catalogs."""
    from games.services.generation_api import GenerationApiError, get_client

    asset_type = request.GET.get("type") or None
    game_filter = request.GET.get("game_id") or None
    q = (request.GET.get("q") or "").strip().lower()
    scope = request.GET.get("scope") or "all"
    offset, limit = page_params(request, default_limit=24)

    games = request.user.games.exclude(status=GameStatus.REMOVED).exclude(service_game_id="")
    if game_filter:
        games = games.filter(id=game_filter)
    locale = _locale(request)

    items: list[dict] = []
    client = get_client()
    for game in games.select_related("current_version")[:50]:
        current = game.current_version
        if not current or not current.service_version_id:
            continue
        try:
            listing = client.get_version_files(game.service_game_id,
                                               current.service_version_id)
        except GenerationApiError:
            continue
        except AttributeError:
            break  # engine client predates version-files support
        for f in listing.get("items") or []:
            kind = f.get("kind") or ""
            if kind not in ("image", "audio"):
                continue
            if asset_type and kind != asset_type:
                continue
            path = f.get("path") or ""
            if q and q not in path.lower():
                continue
            items.append({
                "id": f"{game.id}:{path}",
                "type": kind,
                "url": f.get("url") or "",
                "prompt": None,
                "provider": "engine",
                "cost_cents": 0,
                "created_at": current.created_at.isoformat(),
                "game": {
                    "id": str(game.id),
                    "title": game.title(locale),
                    "slug": game.slug,
                    "cover_url": game.cover_url or None,
                },
                "version_id": str(current.id),
                "in_current_version": True,
            })
    del scope  # all assets we can enumerate live in the current version
    page = items[offset : offset + limit]
    return JsonResponse({
        "items": page,
        "next_cursor": str(offset + limit) if len(items) > offset + limit else None,
    })


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------

@api_view("GET", auth=True)
def notifications(request):
    offset, limit = page_params(request)
    locale = _locale(request)
    qs = Notification.objects.filter(recipient=request.user).select_related("actor", "game")
    return JsonResponse(paginate(qs, offset, limit, lambda n: notification_payload(n, locale)))


@api_view("GET", auth=True)
def unread_count(request):
    return JsonResponse({
        "count": Notification.objects.filter(recipient=request.user, read=False).count()
    })


@api_view("POST", auth=True)
def mark_notifications_read(request):
    Notification.objects.filter(recipient=request.user, read=False).update(read=True)
    return no_content()


# ---------------------------------------------------------------------------
# Credits & subscription
# ---------------------------------------------------------------------------

def _next_utc_midnight() -> str:
    now = timezone.now()
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return tomorrow.isoformat()


@api_view("GET", auth=True)
def credits(request):
    offset, limit = page_params(request)
    page = paginate(request.user.credit_ledger.all(), offset, limit, ledger_entry)
    page["balance"] = request.user.credits_balance_cents
    return JsonResponse(page)


@api_view("POST", auth=True)
def claim_daily(request):
    from billing.models import CreditLedger
    from billing.services import grant_daily

    plan = _subscription(request.user).plan
    if "daily_claim" not in PLAN_CATALOG.get(plan, PLAN_CATALOG["free"])["features"]:
        raise ApiError(VALIDATION_ERROR, "Your plan doesn't include a daily claim.",
                       status=400)
    today = timezone.now().date().isoformat()
    already = CreditLedger.objects.filter(
        user=request.user, kind=CreditLedger.Kind.GRANT_DAILY,
        idempotency_key=f"daily:{today}",
    ).exists()
    if already:
        raise ApiError(CONFLICT, "Already claimed today.",
                       details={"next_claim_at": _next_utc_midnight()})
    balance = grant_daily(request.user)
    return JsonResponse({
        "granted": getattr(settings, "DAILY_CREDITS_CENTS", 100),
        "balance": balance,
        "next_claim_at": _next_utc_midnight(),
    })


PLAN_CATALOG = {
    "free": {
        "key": "free",
        "name": "Free",
        "monthly_price_cents": 0,
        "yearly_price_cents": 0,
        "features": ["daily_claim"],
    },
    "pro": {
        "key": "pro",
        "name": "Pro",
        "monthly_price_cents": 1500,
        "yearly_price_cents": 14400,
        "features": ["monthly_credits", "bigger_budgets", "priority_queue", "no_daily_limits"],
    },
    "studio": {
        "key": "studio",
        "name": "Studio",
        "monthly_price_cents": 0,
        "yearly_price_cents": 0,
        "features": ["custom_credits", "biggest_budgets", "priority_support", "manual_onboarding"],
    },
}


def _subscription(user):
    from billing.models import Subscription

    sub, _ = Subscription.objects.get_or_create(user=user)
    return sub


@api_view("GET", auth=True)
def subscription(request):
    from billing.models import CreditLedger

    sub = _subscription(request.user)
    plan = PLAN_CATALOG.get(sub.plan, PLAN_CATALOG["free"])
    period_start = sub.period_start or request.user.created_at
    period_end = sub.period_end or (timezone.now() + timedelta(days=30))
    spent = -sum(
        row.amount_cents
        for row in CreditLedger.objects.filter(
            user=request.user, kind=CreditLedger.Kind.SPEND_JOB,
            created_at__gte=period_start,
        )
    )
    period_total = 2000 if sub.plan == "pro" else getattr(
        settings, "INITIAL_FREE_CREDITS_CENTS", 500
    )
    return JsonResponse({
        "plan": plan,
        "interval": "monthly",
        "status": sub.status,
        "period_end": period_end.isoformat(),
        "credits": {
            "remaining": max(0, request.user.credits_balance_cents),
            "used_this_period": max(0, spent),
            "period_total": period_total,
        },
        "checkout_available": True,
    })


@api_view("POST", auth=True)
def checkout(request):
    """Fake-provider checkout (parity with the reference dev provider):
    activates the plan immediately and redirects back to billing."""
    body = json_body(request)
    plan = str(body.get("plan") or "")
    if plan == "studio":
        raise ApiError(VALIDATION_ERROR, "Studio is contact-only.",
                       details={"contact_only": True})
    if plan != "pro":
        raise ApiError(VALIDATION_ERROR, "Unknown plan.")
    from billing.models import Subscription
    from billing.services import grant

    sub = _subscription(request.user)
    sub.plan = Subscription.Plan.PRO
    sub.status = Subscription.Status.ACTIVE
    sub.period_start = timezone.now()
    sub.period_end = timezone.now() + timedelta(days=30)
    sub.save()
    request.user.daily_gen_quota = max(request.user.daily_gen_quota, 100)
    request.user.save(update_fields=["daily_gen_quota"])
    grant(request.user, "grant_plan_reset", 2000, note="Pro plan credits",
          idempotency_key=f"pro:{sub.period_start.date().isoformat()}")
    return JsonResponse({"url": "/account/billing?checkout=success"})


# ---------------------------------------------------------------------------
# Creator dashboard & payouts
# ---------------------------------------------------------------------------

MONETIZATION = {
    "cpm_min_cents": 50,
    "cpm_max_cents": 200,
    "max_paid_plays": 100_000,
    "min_live_games": 3,
    "min_payout_cents": 1000,
    "free_daily_generations": 10,
}


def _monetization(user) -> dict:
    live_games = user.games.filter(status=GameStatus.LIVE).count()
    return {
        **MONETIZATION,
        "eligible": live_games >= MONETIZATION["min_live_games"],
        "live_games": live_games,
    }


def _earnings(user) -> tuple[int, int]:
    from billing.models import PayoutRequest

    total = sum(e.amount_cents for e in user.earnings.all())
    paid_or_pending = sum(
        p.amount_cents
        for p in PayoutRequest.objects.filter(user=user)
        .exclude(status=PayoutRequest.Status.REJECTED)
    )
    return total, max(0, total - paid_or_pending)


@api_view("GET", auth=True)
def creator_overview(request):
    from django.db.models import Sum

    user = request.user
    games = user.games.exclude(status=GameStatus.REMOVED)
    agg = games.aggregate(
        plays=Sum("play_count"), likes=Sum("like_count"), remixes=Sum("remix_count"),
        saves=Sum("save_count"),
    )
    total, balance = _earnings(user)
    return JsonResponse({
        "stats": {
            "followers": user.follower_count,
            "following": user.following_count,
            "plays": agg["plays"] or 0,
            "likes": agg["likes"] or 0,
            "remixes": agg["remixes"] or 0,
            "saves": agg["saves"] or 0,
            "live_games": games.filter(status=GameStatus.LIVE).count(),
        },
        "earnings": {"total_earned_cents": total, "balance_cents": balance},
        "monetization": _monetization(user),
    })


@api_view("GET", "POST", auth=True)
def payouts(request):
    from billing.models import PayoutRequest

    user = request.user
    total, balance = _earnings(user)
    monetization = _monetization(user)

    if request.method == "POST":
        if PayoutRequest.objects.filter(user=user,
                                        status=PayoutRequest.Status.PENDING).exists():
            raise ApiError(CONFLICT, "A payout request is already pending.")
        if balance < MONETIZATION["min_payout_cents"] or not monetization["eligible"]:
            raise ApiError(VALIDATION_ERROR, "You haven't reached the minimum payout yet.")
        PayoutRequest.objects.create(user=user, amount_cents=balance)
        total, balance = _earnings(user)

    offset, limit = page_params(request)
    pending = PayoutRequest.objects.filter(user=user,
                                           status=PayoutRequest.Status.PENDING).first()
    page = paginate(
        PayoutRequest.objects.filter(user=user).exclude(status=PayoutRequest.Status.PENDING),
        offset, limit, payout_payload,
    )
    return JsonResponse({
        "balance_cents": balance,
        "min_payout_cents": MONETIZATION["min_payout_cents"],
        "can_request": (
            balance >= MONETIZATION["min_payout_cents"]
            and monetization["eligible"]
            and pending is None
        ),
        "pending": payout_payload(pending) if pending else None,
        "items": page["items"],
        "next_cursor": page["next_cursor"],
        "monetization": monetization,
    })
