"""Tests for the Codply web flow (engine calls mocked)."""

from __future__ import annotations

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from games.models import (
    Game,
    GameStatus,
    GameVersion,
    GenerationJobRef,
    JobStatus,
    Visibility,
)
from games.services.prompt_validation import PromptVerdict

User = get_user_model()

PLAY_URL = "http://localhost:8002/games/svc-game-1/index.html"


QUESTIONS = [
    {
        "id": "q_1",
        "question": "What theme?",
        "options": [{"id": "opt_1", "label": "Space"}, {"id": "opt_2", "label": "Jungle"}],
        "default_option_id": "opt_1",
    }
]


class FakeClient:
    """Mirrors the engine's public API shapes (see generation-service DTOs)."""

    def __init__(self, generation_status="succeeded", error=None):
        self._generation_status = generation_status
        self._error = error
        self.answers_submitted = None
        self.cancelled = False
        self.rolled_back_to = None

    def start_generation(self, prompt, locale=None, skip_questions=False):
        return {"id": "svc-job-1", "status": "queued", "stage": "queued"}

    def get_generation(self, job_id):
        snap = {"id": job_id, "status": self._generation_status, "stage": "done"}
        if self._generation_status == "succeeded":
            snap["game_id"] = "svc-game-1"
        if self._generation_status == "awaiting_input":
            snap["stage"] = "clarifying"
            snap["questions"] = QUESTIONS
        if self._error:
            snap["error"] = self._error
        return snap

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

    def submit_answers(self, job_id, answers):
        self.answers_submitted = (job_id, answers)
        return {"id": job_id, "status": "queued"}

    def cancel_generation(self, job_id):
        self.cancelled = True
        return {"id": job_id, "status": "failed"}

    def list_versions(self, game_id):
        # Two versions from two different jobs: finalize must pick by job_id,
        # not "the newest" (out-of-order syncs would mislabel versions).
        return {
            "items": [
                {
                    "id": "svc-v1",
                    "version_no": 1,
                    "parent_id": None,
                    "job_id": "svc-job-1",
                    "change_summary": "Initial version",
                    "play_url": f"http://localhost:8002/games/{game_id}/v1/index.html",
                    "created_at": "2026-07-16T00:00:00Z",
                },
                {
                    "id": "svc-v2",
                    "version_no": 2,
                    "parent_id": "svc-v1",
                    "job_id": "svc-job-other",
                    "change_summary": "someone else's edit",
                    "play_url": f"http://localhost:8002/games/{game_id}/v2/index.html",
                    "created_at": "2026-07-16T00:01:00Z",
                },
            ],
            "current_version_id": "svc-v2",
        }

    def get_version_source(self, game_id, version_id):
        return {
            "version_id": version_id,
            "source_html": "<!doctype html><title>x</title>",
            "game_js": "// js",
            "game_css": ".x{}",
        }

    def rollback(self, game_id, version_id):
        self.rolled_back_to = version_id
        return {"version_id": version_id, "version_no": 1, "play_url": PLAY_URL}


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
        # The workspace is a React island now — the page ships the mount node
        # plus its server-rendered props (the island talks to /api/v1/*).
        self.assertContains(r, 'id="workspace-island"')
        self.assertContains(r, 'id="workspace-island-props"')
        self.assertContains(r, str(game.id))
        # Finalize mirrored THIS job's engine version (matched by job_id),
        # not the catalog's newest entry (svc-v2 belongs to another job).
        version = game.versions.get()
        self.assertEqual(version.service_version_id, "svc-v1")
        self.assertIn("/v1/index.html", version.play_url)


class StudioRoutesTests(TestCase):
    """The island-era studio URL shapes: /studio, /studio/{id}, /g/{slug}/studio."""

    def setUp(self):
        self.owner = User.objects.create_user(email="o@x.com", password="pass12345")

    def test_studio_home_requires_login(self):
        r = self.client.get("/studio")
        self.assertEqual(r.status_code, 302)
        self.assertIn("/login", r.headers["Location"])

    def test_studio_home_renders_island_shell(self):
        self.client.force_login(self.owner)
        r = self.client.get("/studio")
        self.assertEqual(r.status_code, 200)
        self.assertContains(r, 'id="workspace-island"')
        self.assertContains(r, 'id="workspace-island-props"')
        self.assertContains(r, "dist/islands/workspace.js")
        # Bare shell: no site chrome — the island renders its own top bar.
        self.assertNotContains(r, "chrome/_topbar")

    def test_studio_strangers_get_the_guard_screen_not_a_404(self):
        # Reference parity: the island's ownerGuard renders the branded Lock
        # EmptyState — the server always serves the shell.
        game = _live_public_game(self.owner)
        stranger = User.objects.create_user(email="s@x.com", password="pass12345")
        self.client.force_login(stranger)
        r = self.client.get(f"/studio/{game.id}")
        self.assertEqual(r.status_code, 200)
        self.assertContains(r, 'id="workspace-island"')

    def test_studio_slug_resolves_like_owner_guard(self):
        game = _live_public_game(self.owner)
        self.client.force_login(self.owner)
        r = self.client.get("/studio/my-game")
        self.assertEqual(r.status_code, 301)
        self.assertEqual(r.headers["Location"], f"/studio/{game.id}")
        stranger = User.objects.create_user(email="s2@x.com", password="pass12345")
        self.client.force_login(stranger)
        r = self.client.get("/studio/my-game")
        self.assertEqual(r.status_code, 302)
        self.assertEqual(r.headers["Location"], "/g/my-game")

    def test_game_studio_redirects_owner_to_workspace(self):
        game = _live_public_game(self.owner)
        self.client.force_login(self.owner)
        r = self.client.get("/g/my-game/studio")
        self.assertEqual(r.status_code, 301)
        self.assertEqual(r.headers["Location"], f"/studio/{game.id}")

    def test_game_studio_anon_logs_in_first(self):
        _live_public_game(self.owner)
        r = self.client.get("/g/my-game/studio")
        self.assertEqual(r.status_code, 302)
        self.assertEqual(r.headers["Location"], "/login?next=/g/my-game/studio")

    def test_game_studio_sends_non_owner_to_the_guard(self):
        game = _live_public_game(self.owner)
        stranger = User.objects.create_user(email="s3@x.com", password="pass12345")
        self.client.force_login(stranger)
        r = self.client.get("/g/my-game/studio")
        self.assertEqual(r.status_code, 302)
        self.assertEqual(r.headers["Location"], f"/studio/{game.id}")

    def test_create_renders_island_with_idea_props(self):
        self.client.force_login(self.owner)
        r = self.client.get("/create?idea=a+neon+snake+game")
        self.assertEqual(r.status_code, 200)
        self.assertContains(r, 'id="create-island"')
        self.assertContains(r, 'id="create-island-props"')
        self.assertContains(r, "a neon snake game")
        self.assertContains(r, "dist/islands/create.js")


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


class ClarifyFlowTests(TestCase):
    """awaiting_input surfaces questions; answers resume; cancel stops."""

    def setUp(self):
        self.user = User.objects.create_user(email="c@x.com", password="pass12345")
        self.client.force_login(self.user)
        self.game = Game.objects.create(
            owner=self.user, slug="draft-x", status=GameStatus.DRAFT,
            visibility=Visibility.PRIVATE, prompt="a jungle game",
        )
        self.job = GenerationJobRef.objects.create(
            service_job_id="svc-job-1", user=self.user, game=self.game,
            prompt="a jungle game",
        )

    @patch("games.views.get_client")
    @patch("games.sync.get_client")
    def test_status_carries_questions_while_awaiting(self, sync_client, _views_client):
        sync_client.return_value = FakeClient(generation_status="awaiting_input")
        r = self.client.get(f"/studio/jobs/{self.job.id}/status")
        self.assertEqual(r.status_code, 200)
        payload = r.json()
        self.assertEqual(payload["status"], "awaiting_input")
        self.assertEqual(payload["questions"][0]["id"], "q_1")
        self.job.refresh_from_db()
        self.assertEqual(self.job.questions, QUESTIONS)

    @patch("games.views.get_client")
    def test_answers_resume(self, views_client):
        fake = FakeClient()
        views_client.return_value = fake
        self.job.status = JobStatus.AWAITING_INPUT
        self.job.questions = QUESTIONS
        self.job.save()
        r = self.client.post(
            f"/studio/jobs/{self.job.id}/answers",
            data='{"answers": {"q_1": "opt_2"}}',
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["status"], "resumed")
        self.assertEqual(fake.answers_submitted, ("svc-job-1", {"q_1": "opt_2"}))
        self.job.refresh_from_db()
        self.assertEqual(self.job.status, JobStatus.RUNNING)
        self.assertEqual(self.job.questions, [])

    @patch("games.views.get_client")
    def test_answers_require_ownership(self, views_client):
        views_client.return_value = FakeClient()
        stranger = User.objects.create_user(email="s@x.com", password="pass12345")
        self.client.force_login(stranger)
        r = self.client.post(
            f"/studio/jobs/{self.job.id}/answers",
            data='{"answers": {}}',
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 404)

    @patch("games.views.get_client")
    def test_cancel(self, views_client):
        fake = FakeClient()
        views_client.return_value = fake
        r = self.client.post(f"/studio/jobs/{self.job.id}/cancel")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(fake.cancelled)
        self.job.refresh_from_db()
        self.assertEqual(self.job.status, JobStatus.CANCELLED)

    @patch("games.views.get_client")
    @patch("games.sync.get_client")
    def test_sync_maps_engine_cancel_to_cancelled(self, sync_client, _views_client):
        """The engine records a creator cancel as failed+error_code=cancelled;
        the local mirror must keep the distinct CANCELLED status so the
        workspace shows 'stopped', not a failure card."""
        sync_client.return_value = FakeClient(
            generation_status="failed",
            error={"code": "cancelled", "message": "cancelled by the creator"},
        )
        r = self.client.get(f"/studio/jobs/{self.job.id}/status")
        self.assertEqual(r.json()["status"], "cancelled")
        self.job.refresh_from_db()
        self.assertEqual(self.job.status, JobStatus.CANCELLED)


class VersionsApiTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(email="o@x.com", password="pass12345")
        self.game = _live_public_game(self.owner)
        self.game.service_game_id = "svc-game-1"
        self.game.save(update_fields=["service_game_id"])
        self.v1 = self.game.current_version
        self.v1.service_version_id = "svc-v1"
        self.v1.save(update_fields=["service_version_id"])
        self.v2 = GameVersion.objects.create(
            game=self.game, version_no=2, parent=self.v1, play_url=PLAY_URL,
            service_version_id="svc-v2", change_summary="make it faster",
        )
        self.game.current_version = self.v2
        self.game.save(update_fields=["current_version"])
        self.client.force_login(self.owner)

    def test_versions_json(self):
        r = self.client.get(f"/games/{self.game.id}/versions")
        self.assertEqual(r.status_code, 200)
        payload = r.json()
        self.assertEqual([v["version_no"] for v in payload["items"]], [1, 2])
        self.assertEqual(payload["current_version_id"], str(self.v2.id))
        self.assertEqual(payload["items"][1]["parent_version_id"], str(self.v1.id))

    def test_versions_json_owner_only(self):
        stranger = User.objects.create_user(email="s@x.com", password="pass12345")
        self.client.force_login(stranger)
        self.assertEqual(self.client.get(f"/games/{self.game.id}/versions").status_code, 404)

    @patch("games.views.get_client")
    def test_version_source(self, views_client):
        views_client.return_value = FakeClient()
        r = self.client.get(f"/games/{self.game.id}/versions/{self.v1.id}/source")
        self.assertEqual(r.status_code, 200)
        payload = r.json()
        self.assertEqual(payload["version_id"], str(self.v1.id))
        self.assertIn("<!doctype html>", payload["source_html"])
        self.assertEqual(payload["game_js"], "// js")

    @patch("games.views.get_client")
    def test_rollback_flips_pointer(self, views_client):
        fake = FakeClient()
        views_client.return_value = fake
        r = self.client.post(
            f"/games/{self.game.id}/rollback", {"version_id": str(self.v1.id)}
        )
        self.assertEqual(r.status_code, 302)
        self.assertEqual(fake.rolled_back_to, "svc-v1")
        self.game.refresh_from_db()
        self.assertEqual(self.game.current_version_id, self.v1.id)

    @patch("games.views.get_client")
    def test_rollback_refused_while_job_active(self, views_client):
        """A rollback mid-rebuild must be refused, never half-applied — the
        engine would reject it and the local pointer must not diverge."""
        fake = FakeClient()
        views_client.return_value = fake
        GenerationJobRef.objects.create(
            service_job_id="svc-job-9", user=self.owner, game=self.game,
            status=JobStatus.RUNNING,
        )
        r = self.client.post(
            f"/games/{self.game.id}/rollback",
            data=f'{{"version_id": "{self.v1.id}"}}',
            content_type="application/json",
            HTTP_ACCEPT="application/json",
        )
        self.assertEqual(r.status_code, 409)
        self.assertIsNone(fake.rolled_back_to)  # engine never called
        self.game.refresh_from_db()
        self.assertEqual(self.game.current_version_id, self.v2.id)  # unchanged
