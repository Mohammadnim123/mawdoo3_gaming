from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase

User = get_user_model()


class AuthFlowTests(TestCase):
    def test_signup_logs_in_and_grants_credits(self):
        r = self.client.post("/login", {
            "mode": "signup", "email": "a@b.com", "password": "supersecret", "next": "/",
        })
        self.assertEqual(r.status_code, 302)
        u = User.objects.get(email="a@b.com")
        self.assertGreater(u.credits_balance_cents, 0)
        self.assertTrue(u.handle)
        self.assertEqual(self.client.get("/me").status_code, 200)

    def test_signup_duplicate_email_rejected(self):
        User.objects.create_user(email="dup@b.com", password="supersecret")
        r = self.client.post("/login", {
            "mode": "signup", "email": "dup@b.com", "password": "supersecret",
        })
        self.assertEqual(r.status_code, 200)
        self.assertEqual(User.objects.filter(email="dup@b.com").count(), 1)

    def test_login_wrong_password_stays_anonymous(self):
        User.objects.create_user(email="x@y.com", password="rightpass1")
        r = self.client.post("/login", {"mode": "login", "email": "x@y.com", "password": "nope"})
        self.assertEqual(r.status_code, 200)
        self.assertNotIn("_auth_user_id", self.client.session)

    def test_login_success_redirects_next(self):
        User.objects.create_user(email="x@y.com", password="rightpass1")
        r = self.client.post("/login", {
            "mode": "login", "email": "x@y.com", "password": "rightpass1", "next": "/me",
        })
        self.assertEqual(r.status_code, 302)
        self.assertEqual(r.headers["Location"], "/me")

    def test_login_rejects_open_redirect(self):
        User.objects.create_user(email="x@y.com", password="rightpass1")
        r = self.client.post("/login", {
            "mode": "login", "email": "x@y.com", "password": "rightpass1",
            "next": "https://evil.example/",
        })
        self.assertEqual(r.headers["Location"], "/")

    def test_me_requires_login(self):
        r = self.client.get("/me")
        self.assertEqual(r.status_code, 302)
        self.assertIn("/login", r.headers["Location"])

    def test_public_profile_renders(self):
        u = User.objects.create_user(email="c@d.com", password="pass12345")
        self.assertEqual(self.client.get(f"/u/{u.handle}").status_code, 200)

    def test_magic_link_is_enumeration_safe(self):
        r = self.client.post("/login", {"mode": "magic", "email": "ghost@nowhere.com"})
        self.assertEqual(r.status_code, 200)  # always "check your email"

    def test_logout(self):
        User.objects.create_user(email="e@f.com", password="pass12345")
        self.client.post("/login", {"mode": "login", "email": "e@f.com", "password": "pass12345"})
        r = self.client.post("/logout")
        self.assertEqual(r.status_code, 302)
        self.assertNotIn("_auth_user_id", self.client.session)
