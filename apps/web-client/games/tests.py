"""Tests for the Codply web flow (engine calls mocked)."""

from __future__ import annotations

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from games.models import Game, GameStatus, GameVersion, Visibility
from games.services.prompt_validation import PromptVerdict

User = get_user_model()

PLAY_URL = "http://localhost:8002/games/svc-game-1/index.html"


class FakeClient:
    def start_generation(self, prompt, locale=None, skip_questions=False):
        return {"id": "svc-job-1", "status": "queued", "stage": "queued"}

    def get_generation(self, job_id):
        return {"id": job_id, "status": "succeeded", "stage": "done", "game_id": "svc-game-1"}

    def get_game(self, game_id):
        return {
            "id": game_id,
            "title": {"en": "My Game", "ar": "لعبتي"},
            "genre": "arcade",
            "summary": "A fun game",
            "default_locale": "en",
            "play_url": PLAY_URL,
        }

    def start_tweak(self, game_id, instruction):
        return {"id": "svc-job-2", "status": "queued"}


def _live_public_game(owner) -> Game:
    game = Game.objects.create(
        owner=owner, slug="my-game", title_en="My Game", title_ar="لعبتي",
        genre="arcade", status=GameStatus.LIVE, visibility=Visibility.PUBLIC,
        published_at=timezone.now(),
    )
    v = GameVersion.objects.create(game=game, version_no=1, play_url=PLAY_URL)
    game.current_version = v
    game.save(update_fields=["current_version"])
    return game


class HomeFeedTests(TestCase):
    def test_home_renders_empty(self):
        self.assertEqual(self.client.get("/").status_code, 200)

    def test_home_lists_public_live_games(self):
        owner = User.objects.create_user(email="o@x.com", password="pass12345")
        _live_public_game(owner)
        # Locale-independent assertion (default locale is Arabic, so the card
        # renders the Arabic title): the game links to its public page.
        self.assertContains(self.client.get("/"), "/g/my-game")


class CreateFlowTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email="c@x.com", password="pass12345")

    def test_create_requires_login(self):
        r = self.client.get("/create")
        self.assertEqual(r.status_code, 302)
        self.assertIn("/login", r.headers["Location"])

    @patch("games.views.get_client", return_value=FakeClient())
    @patch("games.views.validate_prompt", return_value=PromptVerdict(valid=True))
    def test_create_starts_generation_and_drafts_game(self, _v, _c):
        self.client.force_login(self.user)
        r = self.client.post("/create", {"prompt": "a neon snake game"})
        self.assertEqual(r.status_code, 302)
        self.assertIn("/studio/", r.headers["Location"])
        game = Game.objects.get(owner=self.user)
        self.assertEqual(game.status, GameStatus.DRAFT)
        self.assertEqual(game.jobs.count(), 1)

    @patch("games.views.validate_prompt",
           return_value=PromptVerdict(valid=False, reason="not a game"))
    def test_create_rejects_invalid_prompt(self, _v):
        self.client.force_login(self.user)
        r = self.client.post("/create", {"prompt": "write me an essay please"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(Game.objects.filter(owner=self.user).count(), 0)

    @patch("games.sync.get_client", return_value=FakeClient())
    @patch("games.views.get_client", return_value=FakeClient())
    @patch("games.views.validate_prompt", return_value=PromptVerdict(valid=True))
    def test_studio_finalizes_succeeded_job(self, _v, _c, _sc):
        self.client.force_login(self.user)
        self.client.post("/create", {"prompt": "a neon snake game"})
        game = Game.objects.get(owner=self.user)
        r = self.client.get(f"/studio/{game.id}")
        self.assertEqual(r.status_code, 200)
        game.refresh_from_db()
        self.assertEqual(game.status, GameStatus.LIVE)
        self.assertEqual(game.title_en, "My Game")
        self.assertTrue(game.versions.exists())
        self.assertContains(r, "iframe")


class GameDetailTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(email="o@x.com", password="pass12345")

    def test_public_game_detail_renders(self):
        _live_public_game(self.owner)
        r = self.client.get("/g/my-game")
        self.assertEqual(r.status_code, 200)
        self.assertContains(r, PLAY_URL)

    def test_private_game_hidden_from_strangers(self):
        game = _live_public_game(self.owner)
        game.visibility = Visibility.PRIVATE
        game.save(update_fields=["visibility"])
        self.assertEqual(self.client.get("/g/my-game").status_code, 404)

    def test_owner_can_view_private_game(self):
        game = _live_public_game(self.owner)
        game.visibility = Visibility.PRIVATE
        game.save(update_fields=["visibility"])
        self.client.force_login(self.owner)
        self.assertEqual(self.client.get("/g/my-game").status_code, 200)


class PublishTests(TestCase):
    @patch("games.sync.get_client", return_value=FakeClient())
    def test_post_sets_visibility_public(self, _sc):
        owner = User.objects.create_user(email="o@x.com", password="pass12345")
        game = _live_public_game(owner)
        game.visibility = Visibility.PRIVATE
        game.save(update_fields=["visibility"])
        self.client.force_login(owner)
        r = self.client.post(f"/games/{game.id}/post", {"visibility": "public"})
        self.assertEqual(r.status_code, 302)
        game.refresh_from_db()
        self.assertEqual(game.visibility, Visibility.PUBLIC)
