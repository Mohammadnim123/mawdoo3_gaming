"""Contract serializers: Django models → the Codply wire shapes.

Every function returns a dict that parses against the matching zod schema in
`frontend/src/vendor/contracts/schemas.ts`. Field names, nullability and enum
values are the contract — do not restyle them.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any
from urllib.parse import urlsplit

from games.models import Game, GameVersion, GenerationJobRef, JobStatus, JobType


def _iso(dt) -> str | None:
    return dt.isoformat() if dt else None


def _or_null(value: str) -> str | None:
    return value or None


def play_src(url: str, locale: str) -> str:
    """Play URL with the viewer's locale threaded to the game runtime."""
    if not url:
        return url
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}lang={locale}"


def game_origin(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}" if parts.scheme else ""


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

def game_owner(user) -> dict[str, Any]:
    return {
        "handle": user.handle,
        "display_name": _or_null(user.display_name),
        "avatar_url": _or_null(user.avatar_url),
    }


def user_payload(user) -> dict[str, Any]:
    return {
        "id": str(user.id),
        "handle": user.handle,
        "display_name": _or_null(user.display_name),
        "avatar_url": _or_null(user.avatar_url),
        "bio": _or_null(user.bio),
        "email": user.email,
        "role": user.role,
        "created_at": _iso(user.created_at),
    }


def me_payload(user) -> dict[str, Any]:
    from billing.services import generations_today

    payload = user_payload(user)
    payload["quota"] = {
        "daily_limit": user.daily_gen_quota,
        "used_today": generations_today(user),
    }
    payload["credits_cents"] = user.credits_balance_cents
    return payload


def profile_payload(user, *, stats: dict[str, int],
                    viewer_following: bool | None) -> dict[str, Any]:
    return {
        "user": {
            **game_owner(user),
            "bio": _or_null(user.bio),
            "created_at": _iso(user.created_at),
        },
        "stats": stats,
        "viewer": {"following": viewer_following} if viewer_following is not None else None,
    }


# ---------------------------------------------------------------------------
# Games
# ---------------------------------------------------------------------------

def comment_preview(comment) -> dict[str, Any]:
    return {
        "id": str(comment.id),
        "body": comment.body,
        "author": game_owner(comment.user),
        "created_at": _iso(comment.created_at),
    }


def feed_item(
    game: Game,
    locale: str,
    *,
    viewer: dict[str, bool] | None,
    preview_comments: Iterable | None = None,
) -> dict[str, Any]:
    return {
        "id": str(game.id),
        "slug": game.slug,
        "title": game.title(locale),
        "description": _or_null(game.summary(locale)),
        "cover_url": _or_null(game.cover_url),
        "genre": _or_null(game.genre),
        "owner": game_owner(game.owner),
        "play_count": game.play_count,
        "remix_count": game.remix_count,
        "like_count": game.like_count,
        "comment_count": game.comment_count,
        "save_count": game.save_count,
        "share_count": game.share_count,
        "viewer": viewer,
        "preview_comments": [comment_preview(c) for c in (preview_comments or [])],
        "published_at": _iso(game.published_at),
        "created_at": _iso(game.created_at),
    }


def game_payload(game: Game, locale: str, *, viewer, preview_comments=None) -> dict[str, Any]:
    payload = feed_item(game, locale, viewer=viewer, preview_comments=preview_comments)
    payload["visibility"] = game.visibility
    return payload


def game_detail(game: Game, locale: str, *, viewer, preview_comments=None) -> dict[str, Any]:
    payload = game_payload(game, locale, viewer=viewer, preview_comments=preview_comments)
    current = game.current_version if game.current_version_id else None
    payload["current_version"] = (
        {
            "id": str(current.id),
            "play_url": play_src(current.play_url, locale),
            "change_summary": _or_null(current.change_summary),
        }
        if current
        else None
    )
    src = game.remixed_from
    payload["remixed_from"] = (
        {"id": str(src.id), "slug": src.slug, "title": src.title(locale)} if src else None
    )
    return payload


def my_game(game: Game, locale: str) -> dict[str, Any]:
    return {
        "id": str(game.id),
        "slug": game.slug,
        "title": (game.title(locale) if (game.title_en or game.title_ar)
                  else (game.prompt[:60] or game.slug)),
        "cover_url": _or_null(game.cover_url),
        "genre": _or_null(game.genre),
        "owner": game_owner(game.owner),
        "status": game.status,
        "visibility": game.visibility,
        "play_count": game.play_count,
        "remix_count": game.remix_count,
        "like_count": game.like_count,
        "comment_count": game.comment_count,
        "save_count": game.save_count,
        "share_count": game.share_count,
        "play_url": play_src(game.play_url, locale) if game.is_live else None,
        "created_at": _iso(game.created_at),
        "updated_at": _iso(game.updated_at),
    }


def version_payload(version: GameVersion, locale: str) -> dict[str, Any]:
    return {
        "id": str(version.id),
        "version_no": version.version_no,
        "parent_version_id": str(version.parent_id) if version.parent_id else None,
        "change_summary": _or_null(version.change_summary),
        "created_at": _iso(version.created_at),
        "play_url": play_src(version.play_url, locale),
    }


# ---------------------------------------------------------------------------
# Comments & notifications
# ---------------------------------------------------------------------------

def comment_payload(comment, *, viewer_liked: bool, preview_replies=None) -> dict[str, Any]:
    payload = {
        "id": str(comment.id),
        "body": "" if comment.deleted else comment.body,
        "user": game_owner(comment.user),
        "parent_comment_id": str(comment.parent_id) if comment.parent_id else None,
        "reply_count": comment.reply_count,
        "like_count": comment.like_count,
        "viewer_liked": viewer_liked,
        "edited_at": _iso(getattr(comment, "edited_at", None)),
        "deleted": comment.deleted,
        "created_at": _iso(comment.created_at),
    }
    if preview_replies is not None:
        payload["preview_replies"] = preview_replies
    return payload


def notification_payload(n, locale: str) -> dict[str, Any]:
    return {
        "id": str(n.id),
        "type": n.type,
        "actor": game_owner(n.actor),
        "game": (
            {
                "id": str(n.game.id),
                "slug": n.game.slug,
                "title": n.game.title(locale),
                "cover_url": _or_null(n.game.cover_url),
            }
            if n.game_id
            else None
        ),
        "comment_excerpt": _or_null(n.comment_excerpt),
        "read": n.read,
        "created_at": _iso(n.created_at),
    }


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------

_JOB_TYPE = {
    JobType.CREATE: "generate",
    JobType.EDIT: "edit",
    JobType.REMIX: "remix",
}

_JOB_STATUS = {
    JobStatus.QUEUED: "queued",
    JobStatus.RUNNING: "running",
    JobStatus.AWAITING_INPUT: "awaiting_input",
    JobStatus.SUCCEEDED: "done",
    JobStatus.FAILED: "failed",
    JobStatus.CANCELLED: "failed",
    JobStatus.EXPIRED: "expired",
}


def job_status_value(ref: GenerationJobRef) -> str:
    return _JOB_STATUS.get(ref.status, "running")


def job_payload(
    ref: GenerationJobRef,
    locale: str,
    *,
    steps: list[dict] | None = None,
    transcript: list[dict] | None = None,
) -> dict[str, Any]:
    game = ref.game
    error_user_msg = ref.error_message or None
    if ref.status == JobStatus.CANCELLED and not error_user_msg:
        error_user_msg = "Cancelled."
    return {
        "id": str(ref.id),
        "type": _JOB_TYPE.get(ref.type, "generate"),
        "status": job_status_value(ref),
        "steps": steps or [],
        "transcript": transcript or [],
        "game_id": str(game.id) if game else None,
        "play_url": play_src(game.play_url, locale) if (game and game.is_live) else None,
        "error_user_msg": error_user_msg,
        "questions": ref.questions or None,
    }


# ---------------------------------------------------------------------------
# Billing
# ---------------------------------------------------------------------------

def ledger_entry(row) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "kind": row.kind,
        "delta": row.amount_cents,
        "note": _or_null(row.note),
        "job_id": str(row.job_id) if row.job_id else None,
        "created_at": _iso(row.created_at),
    }


def payout_payload(p) -> dict[str, Any]:
    return {
        "id": str(p.id),
        "amount_cents": p.amount_cents,
        "status": p.status,
        "created_at": _iso(p.created_at),
    }
