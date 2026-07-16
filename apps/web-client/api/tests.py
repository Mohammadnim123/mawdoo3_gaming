"""Contract-layer tests: shapes + auth boundaries for /api/v1.

These don't exercise the engine (it's stubbed at the client boundary); they
pin the wire shapes the React islands parse with zod.
"""

from __future__ import annotations

import json
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from games.models import (
    Game,
    GameStatus,
    GameVersion,
    GenerationJobRef,
    JobStatus,
    JobType,
    Visibility,
)

User = get_user_model()


def make_user(email="p1@example.com", **kwargs):
    return User.objects.create_user(email=email, password="password123", **kwargs)


def make_live_game(owner, slug="tetris", title="Tetris", public=True):
    game = Game.objects.create(
        owner=owner, slug=slug, title_en=title,
        visibility=Visibility.PUBLIC if public else Visibility.PRIVATE,
        status=GameStatus.LIVE, genre="arcade",
        service_game_id="svc-1", published_at=timezone.now(),
    )
    version = GameVersion.objects.create(
        game=game, version_no=1, play_url="http://cdn.local/games/svc-1/v1/index.html",
        service_version_id="v1",
    )
    game.current_version = version
    game.save(update_fields=["current_version"])
    return game


class AuthApiTests(TestCase):
    def test_signup_is_enumeration_safe(self):
        for _ in range(2):
            resp = self.client.post(
                "/api/v1/auth/signup",
                data=json.dumps({"email": "new@example.com", "password": "longenough1"}),
                content_type="application/json",
            )
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.json(), {"status": "sent"})
        self.assertEqual(User.objects.filter(email="new@example.com").count(), 1)

    def test_login_sets_session_and_returns_user(self):
        make_user()
        resp = self.client.post(
            "/api/v1/auth/login",
            data=json.dumps({"email": "p1@example.com", "password": "password123"}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["token"], "session")
        self.assertEqual(body["user"]["handle"], "p1")
        me = self.client.get("/api/v1/me")
        self.assertEqual(me.status_code, 200)
        self.assertIn("quota", me.json())

    def test_bad_login_is_401_envelope(self):
        make_user()
        resp = self.client.post(
            "/api/v1/auth/login",
            data=json.dumps({"email": "p1@example.com", "password": "wrong"}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.json()["error"], "unauthorized")

    def test_me_requires_auth(self):
        resp = self.client.get("/api/v1/me")
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.json()["error"], "unauthorized")


class FeedApiTests(TestCase):
    def setUp(self):
        self.owner = make_user()
        self.game = make_live_game(self.owner)

    def test_feed_shape(self):
        resp = self.client.get("/api/v1/games")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertIn("items", body)
        self.assertIn("next_cursor", body)
        item = body["items"][0]
        for field in ("id", "slug", "title", "owner", "viewer", "preview_comments",
                      "published_at", "created_at", "like_count", "play_count"):
            self.assertIn(field, item)
        self.assertIsNone(item["viewer"])  # anonymous

    def test_game_detail_by_slug(self):
        resp = self.client.get("/api/v1/games/tetris")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["slug"], "tetris")
        self.assertIn("current_version", body)
        self.assertIn("play_url", body["current_version"])

    def test_private_game_hidden(self):
        self.game.visibility = Visibility.PRIVATE
        self.game.save(update_fields=["visibility"])
        resp = self.client.get("/api/v1/games/tetris")
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp.json()["error"], "not_found")

    def test_play_ping_dedupes(self):
        for _ in range(2):
            resp = self.client.post(
                "/api/v1/games/tetris/play",
                data=json.dumps({"session_hash": "abc123", "source": "feed"}),
                content_type="application/json",
            )
            self.assertEqual(resp.status_code, 204)
        self.game.refresh_from_db()
        self.assertEqual(self.game.play_count, 1)

    def test_patch_updates_title_and_visibility(self):
        self.client.force_login(self.owner)
        resp = self.client.patch(
            f"/api/v1/games/{self.game.id}",
            data=json.dumps({"title": "Neo Tetris", "visibility": "unlisted"}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["title"], "Neo Tetris")
        self.assertEqual(body["visibility"], "unlisted")

    def test_delete_soft_removes(self):
        self.client.force_login(self.owner)
        resp = self.client.delete(f"/api/v1/games/{self.game.id}")
        self.assertEqual(resp.status_code, 204)
        self.game.refresh_from_db()
        self.assertEqual(self.game.status, GameStatus.REMOVED)
        self.assertEqual(self.client.get("/api/v1/games/tetris").status_code, 404)

    def test_patch_requires_owner(self):
        other = make_user("p2@example.com")
        self.client.force_login(other)
        resp = self.client.patch(
            f"/api/v1/games/{self.game.id}",
            data=json.dumps({"title": "Hijack"}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 403)


class CommentApiTests(TestCase):
    def setUp(self):
        self.owner = make_user()
        self.commenter = make_user("p2@example.com")
        self.game = make_live_game(self.owner)

    def _post_comment(self, body="nice game", parent=None):
        payload = {"body": body}
        if parent:
            payload["parent_comment_id"] = str(parent)
        return self.client.post(
            f"/api/v1/games/{self.game.id}/comments",
            data=json.dumps(payload), content_type="application/json",
        )

    def test_comment_thread_with_replies_and_likes(self):
        self.client.force_login(self.commenter)
        top = self._post_comment().json()
        reply = self._post_comment("agreed", parent=top["id"]).json()
        self.assertEqual(reply["parent_comment_id"], top["id"])

        like = self.client.post(f"/api/v1/comments/{top['id']}/like")
        self.assertEqual(like.status_code, 204)

        listing = self.client.get(f"/api/v1/games/{self.game.id}/comments").json()
        item = listing["items"][0]
        self.assertEqual(item["like_count"], 1)
        self.assertTrue(item["viewer_liked"])
        self.assertEqual(item["reply_count"], 1)
        self.assertEqual(len(item["preview_replies"]), 1)

    def test_edit_records_history(self):
        self.client.force_login(self.commenter)
        top = self._post_comment("first").json()
        resp = self.client.patch(
            f"/api/v1/comments/{top['id']}",
            data=json.dumps({"body": "second"}), content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIsNotNone(resp.json()["edited_at"])
        history = self.client.get(f"/api/v1/comments/{top['id']}/history").json()
        self.assertEqual([h["body"] for h in history["items"]], ["first"])

    def test_only_author_edits(self):
        self.client.force_login(self.commenter)
        top = self._post_comment("first").json()
        self.client.force_login(self.owner)
        resp = self.client.patch(
            f"/api/v1/comments/{top['id']}",
            data=json.dumps({"body": "hijack"}), content_type="application/json",
        )
        self.assertEqual(resp.status_code, 403)

    def test_owner_can_delete_tombstone(self):
        self.client.force_login(self.commenter)
        top = self._post_comment("first").json()
        self.client.force_login(self.owner)
        resp = self.client.delete(f"/api/v1/comments/{top['id']}")
        self.assertEqual(resp.status_code, 204)
        listing = self.client.get(f"/api/v1/games/{self.game.id}/comments").json()
        self.assertTrue(listing["items"][0]["deleted"])
        self.assertEqual(listing["items"][0]["body"], "")


class SocialApiTests(TestCase):
    def setUp(self):
        self.owner = make_user()
        self.fan = make_user("fan@example.com")
        self.game = make_live_game(self.owner)

    def test_like_idempotent_post_delete(self):
        self.client.force_login(self.fan)
        self.assertEqual(self.client.post(f"/api/v1/games/{self.game.id}/like").status_code, 204)
        self.assertEqual(self.client.post(f"/api/v1/games/{self.game.id}/like").status_code, 204)
        self.game.refresh_from_db()
        self.assertEqual(self.game.like_count, 1)
        self.assertEqual(self.client.delete(f"/api/v1/games/{self.game.id}/like").status_code, 204)
        self.game.refresh_from_db()
        self.assertEqual(self.game.like_count, 0)

    def test_follow_profile_and_notifications(self):
        self.client.force_login(self.fan)
        follow = self.client.post(f"/api/v1/users/{self.owner.handle}/follow")
        self.assertEqual(follow.status_code, 204)
        profile = self.client.get(f"/api/v1/users/{self.owner.handle}").json()
        self.assertEqual(profile["stats"]["followers"], 1)
        self.assertTrue(profile["viewer"]["following"])

        self.client.force_login(self.owner)
        unread = self.client.get("/api/v1/me/notifications/unread_count").json()
        self.assertEqual(unread["count"], 1)
        listing = self.client.get("/api/v1/me/notifications").json()
        self.assertEqual(listing["items"][0]["type"], "follow")
        self.assertEqual(self.client.post("/api/v1/me/notifications/read").status_code, 204)
        self.assertEqual(
            self.client.get("/api/v1/me/notifications/unread_count").json()["count"], 0
        )

    def test_report(self):
        self.client.force_login(self.fan)
        resp = self.client.post(
            f"/api/v1/games/{self.game.id}/report",
            data=json.dumps({"reason": "broken"}), content_type="application/json",
        )
        self.assertEqual(resp.status_code, 201)


class JobsApiTests(TestCase):
    def setUp(self):
        self.user = make_user()
        self.client.force_login(self.user)

    @mock.patch("api.views_jobs.get_client")
    def test_generate_creates_draft_and_ref(self, get_client):
        get_client.return_value.start_generation.return_value = {"id": "svc-job-1"}
        with mock.patch("games.services.prompt_validation.validate_prompt") as vp:
            vp.return_value = mock.Mock(valid=True, reason="")
            resp = self.client.post(
                "/api/v1/generate",
                data=json.dumps({"prompt": "a neon snake game"}),
                content_type="application/json",
            )
        self.assertEqual(resp.status_code, 202)
        body = resp.json()
        ref = GenerationJobRef.objects.get(id=body["job_id"])
        self.assertEqual(str(ref.game_id), body["game_id"])
        self.assertEqual(ref.type, JobType.CREATE)

    @mock.patch("api.views_jobs.get_client")
    def test_snapshot_shape(self, get_client):
        game = make_live_game(self.user)
        ref = GenerationJobRef.objects.create(
            service_job_id="svc-1", user=self.user, game=game,
            type=JobType.CREATE, prompt="p", status=JobStatus.SUCCEEDED,
        )
        client = get_client.return_value
        client.get_events.return_value = {"items": [
            {"seq": 1, "event": "step",
             "data": {"step": "planning", "label": "Planning", "status": "running"}},
            {"seq": 2, "event": "step",
             "data": {"step": "planning", "label": "Planning", "status": "completed"}},
            {"seq": 3, "event": "message", "data": {"text": "done"}},
        ]}
        resp = self.client.get(f"/api/v1/jobs/{ref.id}")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["status"], "done")
        self.assertEqual(body["type"], "generate")
        self.assertEqual(len(body["steps"]), 1)
        self.assertEqual(body["steps"][0]["status"], "completed")
        self.assertEqual(len(body["transcript"]), 1)

    def test_quota_gate(self):
        self.user.daily_gen_quota = 0
        self.user.save(update_fields=["daily_gen_quota"])
        resp = self.client.post(
            "/api/v1/generate",
            data=json.dumps({"prompt": "a neon snake game"}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 429)
        self.assertEqual(resp.json()["error"], "quota_exceeded")


class BillingApiTests(TestCase):
    def setUp(self):
        self.user = make_user()
        self.client.force_login(self.user)

    def test_claim_daily_then_conflict(self):
        first = self.client.post("/api/v1/me/credits/claim-daily")
        self.assertEqual(first.status_code, 200)
        self.assertIn("next_claim_at", first.json())
        second = self.client.post("/api/v1/me/credits/claim-daily")
        self.assertEqual(second.status_code, 409)
        self.assertIn("next_claim_at", second.json()["details"])

    def test_credits_ledger_shape(self):
        self.client.post("/api/v1/me/credits/claim-daily")
        body = self.client.get("/api/v1/me/credits").json()
        self.assertIn("balance", body)
        row = body["items"][0]
        for field in ("id", "kind", "delta", "note", "job_id", "created_at"):
            self.assertIn(field, row)

    def test_subscription_and_checkout(self):
        sub = self.client.get("/api/v1/me/subscription").json()
        self.assertEqual(sub["plan"]["key"], "free")
        resp = self.client.post(
            "/api/v1/me/subscription/checkout",
            data=json.dumps({"plan": "pro", "interval": "monthly"}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIn("checkout=success", resp.json()["url"])
        sub = self.client.get("/api/v1/me/subscription").json()
        self.assertEqual(sub["plan"]["key"], "pro")

    def test_payouts_gate(self):
        body = self.client.get("/api/v1/me/creator/payouts").json()
        self.assertFalse(body["can_request"])
        resp = self.client.post("/api/v1/me/creator/payouts")
        self.assertEqual(resp.status_code, 422)


class MeLibraryTests(TestCase):
    def setUp(self):
        self.user = make_user()
        self.client.force_login(self.user)
        self.game = make_live_game(self.user)

    def test_my_games_shape(self):
        body = self.client.get("/api/v1/me/games").json()
        item = body["items"][0]
        for field in ("status", "visibility", "play_url", "updated_at"):
            self.assertIn(field, item)

    def test_saves_roundtrip(self):
        other = make_user("o@example.com")
        game = make_live_game(other, slug="pong", title="Pong")
        self.client.post(f"/api/v1/games/{game.id}/save")
        body = self.client.get("/api/v1/me/saves").json()
        self.assertEqual(body["items"][0]["slug"], "pong")

    def test_update_me(self):
        resp = self.client.patch(
            "/api/v1/me",
            data=json.dumps({"display_name": "Player One", "bio": "hi"}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["display_name"], "Player One")
