from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase

from .models import CreditLedger, Subscription
from .services import grant_daily

User = get_user_model()


class BillingTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email="u@x.com", password="pass12345")
        self.client.force_login(self.user)

    def test_billing_page_renders(self):
        self.assertEqual(self.client.get("/account/billing").status_code, 200)

    def test_claim_daily_is_idempotent(self):
        b0 = self.user.credits_balance_cents
        grant_daily(self.user)
        self.user.refresh_from_db()
        b1 = self.user.credits_balance_cents
        self.assertGreater(b1, b0)
        grant_daily(self.user)  # same day → no double grant
        self.user.refresh_from_db()
        self.assertEqual(self.user.credits_balance_cents, b1)
        self.assertEqual(
            CreditLedger.objects.filter(user=self.user, kind="grant_daily").count(), 1
        )

    def test_checkout_upgrades_to_pro(self):
        r = self.client.post("/account/billing/checkout")
        self.assertEqual(r.status_code, 302)
        sub = Subscription.objects.get(user=self.user)
        self.assertEqual(sub.plan, Subscription.Plan.PRO)

    def test_dashboard_and_settings_render(self):
        self.assertEqual(self.client.get("/dashboard").status_code, 200)
        self.assertEqual(self.client.get("/account/settings").status_code, 200)


class QuotaTests(TestCase):
    def test_over_quota_blocks_create(self):
        from unittest.mock import patch

        user = User.objects.create_user(email="q@x.com", password="pass12345")
        user.daily_gen_quota = 0
        user.save(update_fields=["daily_gen_quota"])
        self.client.force_login(user)
        with patch("games.views.validate_prompt"):
            r = self.client.post("/create", {"prompt": "a snake game"})
        self.assertEqual(r.status_code, 302)
        self.assertIn("/account/billing", r.headers["Location"])
