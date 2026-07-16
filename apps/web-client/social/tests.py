from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from games.models import Game, GameStatus, GameVersion, Visibility

from .models import Comment, Follow, Like, Notification, Save

User = get_user_model()


def _game(owner, slug="g1"):
    g = Game.objects.create(
        owner=owner, slug=slug, title_en="G", status=GameStatus.LIVE,
        visibility=Visibility.PUBLIC, published_at=timezone.now(),
    )
    v = GameVersion.objects.create(game=g, version_no=1, play_url="http://x/y")
    g.current_version = v
    g.save(update_fields=["current_version"])
    return g


class EngagementTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(email="o@x.com", password="pass12345")
        self.viewer = User.objects.create_user(email="v@x.com", password="pass12345")
        self.game = _game(self.owner)

    def test_like_toggles_and_notifies(self):
        self.client.force_login(self.viewer)
        self.client.post(f"/games/{self.game.id}/like")
        self.game.refresh_from_db()
        self.assertEqual(self.game.like_count, 1)
        self.assertTrue(Like.objects.filter(user=self.viewer, game=self.game).exists())
        self.assertTrue(Notification.objects.filter(recipient=self.owner, type="like").exists())
        # toggle off
        self.client.post(f"/games/{self.game.id}/like")
        self.game.refresh_from_db()
        self.assertEqual(self.game.like_count, 0)

    def test_save_toggles(self):
        self.client.force_login(self.viewer)
        self.client.post(f"/games/{self.game.id}/save")
        self.assertTrue(Save.objects.filter(user=self.viewer, game=self.game).exists())

    def test_like_requires_login(self):
        r = self.client.post(f"/games/{self.game.id}/like")
        self.assertEqual(r.status_code, 302)
        self.assertIn("/login", r.headers["Location"])

    def test_follow_toggles_and_counts(self):
        self.client.force_login(self.viewer)
        self.client.post(f"/users/{self.owner.handle}/follow")
        self.assertTrue(Follow.objects.filter(follower=self.viewer, following=self.owner).exists())
        self.owner.refresh_from_db()
        self.viewer.refresh_from_db()
        self.assertEqual(self.owner.follower_count, 1)
        self.assertEqual(self.viewer.following_count, 1)

    def test_comment_add_and_delete(self):
        self.client.force_login(self.viewer)
        self.client.post(f"/games/{self.game.id}/comments", {"body": "nice game"})
        self.game.refresh_from_db()
        self.assertEqual(self.game.comment_count, 1)
        c = Comment.objects.get(game=self.game)
        self.assertTrue(Notification.objects.filter(recipient=self.owner, type="comment").exists())
        self.client.post(f"/comments/{c.id}/delete")
        c.refresh_from_db()
        self.assertTrue(c.deleted)
        self.game.refresh_from_db()
        self.assertEqual(self.game.comment_count, 0)


class DiscoveryTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(email="o@x.com", password="pass12345")

    def test_search_finds_public_game(self):
        g = _game(self.owner, slug="snakey")
        g.title_en = "Neon Snake"
        g.save(update_fields=["title_en"])
        r = self.client.get("/search?q=snake")
        self.assertEqual(r.status_code, 200)
        self.assertContains(r, "/g/snakey")

    def test_notifications_page_keeps_unread_until_api_mark(self):
        # The page render must NOT auto-mark (the island shows unread
        # highlights, then marks explicitly via the contract API).
        viewer = User.objects.create_user(email="v@x.com", password="pass12345")
        Notification.objects.create(recipient=self.owner, actor=viewer, type="follow")
        self.client.force_login(self.owner)
        r = self.client.get("/notifications")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(Notification.objects.filter(recipient=self.owner, read=False).count(), 1)
        self.client.post("/api/v1/me/notifications/read")
        self.assertEqual(Notification.objects.filter(recipient=self.owner, read=False).count(), 0)
