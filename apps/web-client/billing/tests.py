from __future__ import annotations

import json
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from . import services
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

    def test_legacy_checkout_does_not_grant_free_pro(self):
        # With no payment provider configured the fallback form must NOT upgrade
        # the account — it bounces back to billing with an error.
        r = self.client.post("/account/billing/checkout")
        self.assertEqual(r.status_code, 302)
        self.assertIn("/account/billing", r.headers["Location"])
        sub, _ = Subscription.objects.get_or_create(user=self.user)
        self.assertEqual(sub.plan, Subscription.Plan.FREE)

    def test_webhook_disabled_when_unconfigured(self):
        r = self.client.post(
            "/api/v1/billing/stripe/webhook", data=b"{}",
            content_type="application/json", HTTP_STRIPE_SIGNATURE="x",
        )
        self.assertEqual(r.status_code, 503)

    def test_dashboard_and_settings_render(self):
        self.assertEqual(self.client.get("/dashboard").status_code, 200)
        self.assertEqual(self.client.get("/account/settings").status_code, 200)


@override_settings(
    STRIPE_SECRET_KEY="sk_test_dummy",
    STRIPE_PUBLISHABLE_KEY="pk_test_dummy",
    STRIPE_WEBHOOK_SECRET="whsec_dummy",
    STRIPE_PRICE_PRO_MONTHLY="price_monthly",
    STRIPE_PRICE_PRO_YEARLY="price_yearly",
)
class StripeCheckoutTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(email="s@x.com", password="pass12345")
        self.client.force_login(self.user)

    def _post_checkout(self, plan="pro", interval="monthly"):
        return self.client.post(
            "/api/v1/me/subscription/checkout",
            data=json.dumps({"plan": plan, "interval": interval}),
            content_type="application/json",
        )

    def test_subscription_reports_checkout_available(self):
        body = self.client.get("/api/v1/me/subscription").json()
        self.assertTrue(body["checkout_available"])

    def test_checkout_returns_stripe_url_without_upgrading(self):
        fake = SimpleNamespace(url="https://checkout.stripe.com/c/pay/cs_test_123")
        with patch("billing.stripe_gateway.create_checkout_session", return_value=fake) as m:
            resp = self._post_checkout()
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["url"], fake.url)
        m.assert_called_once()
        # Crucially: the plan is NOT upgraded by starting checkout.
        sub, _ = Subscription.objects.get_or_create(user=self.user)
        self.assertEqual(sub.plan, Subscription.Plan.FREE)

    def _fake_subscription(self):
        now = timezone.now()
        return {
            "id": "sub_123",
            "customer": "cus_123",
            "items": {"data": [{
                "price": {"id": "price_monthly"},
                "current_period_start": int(now.timestamp()),
                "current_period_end": int((now + timedelta(days=30)).timestamp()),
            }]},
        }

    def _post_webhook(self):
        return self.client.post(
            "/api/v1/billing/stripe/webhook", data=b"{}",
            content_type="application/json", HTTP_STRIPE_SIGNATURE="t=1,v1=sig",
        )

    def test_webhook_upgrades_to_pro_and_is_idempotent(self):
        event = {"type": "checkout.session.completed", "data": {"object": {
            "client_reference_id": str(self.user.id),
            "customer": "cus_123",
            "subscription": "sub_123",
            "metadata": {"user_id": str(self.user.id)},
        }}}
        with patch("billing.stripe_gateway.construct_event", return_value=event), \
                patch("billing.stripe_gateway.retrieve_subscription",
                      return_value=self._fake_subscription()):
            r1 = self._post_webhook()
            r2 = self._post_webhook()  # replay

        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r2.status_code, 200)
        self.user.refresh_from_db()
        sub = Subscription.objects.get(user=self.user)
        self.assertEqual(sub.plan, Subscription.Plan.PRO)
        self.assertEqual(sub.status, Subscription.Status.ACTIVE)
        self.assertEqual(sub.external_subscription_id, "sub_123")
        self.assertEqual(sub.external_customer_id, "cus_123")
        self.assertEqual(sub.external_price_id, "price_monthly")
        self.assertEqual(self.user.daily_gen_quota, services.PRO_DAILY_GEN_QUOTA)
        # Credits granted exactly once despite the replayed event.
        grants = CreditLedger.objects.filter(
            user=self.user, kind=CreditLedger.Kind.GRANT_PLAN_RESET)
        self.assertEqual(grants.count(), 1)

    def test_webhook_rejects_bad_signature(self):
        from billing import stripe_gateway

        with patch("billing.stripe_gateway.construct_event",
                   side_effect=stripe_gateway.WebhookSignatureError("bad")):
            r = self.client.post(
                "/api/v1/billing/stripe/webhook", data=b"{}",
                content_type="application/json", HTTP_STRIPE_SIGNATURE="bad",
            )
        self.assertEqual(r.status_code, 400)
        self.assertFalse(
            Subscription.objects.filter(user=self.user, plan="pro").exists())

    def test_webhook_downgrades_on_subscription_deleted(self):
        services.activate_pro(self.user, subscription_id="sub_123",
                              customer_id="cus_123", price_id="price_monthly")
        self.assertEqual(Subscription.objects.get(user=self.user).plan,
                         Subscription.Plan.PRO)
        event = {"type": "customer.subscription.deleted", "data": {"object": {
            "id": "sub_123", "customer": "cus_123",
            "metadata": {"user_id": str(self.user.id)},
        }}}
        with patch("billing.stripe_gateway.construct_event", return_value=event):
            r = self._post_webhook()
        self.assertEqual(r.status_code, 200)
        sub = Subscription.objects.get(user=self.user)
        self.assertEqual(sub.plan, Subscription.Plan.FREE)
        self.assertEqual(sub.status, Subscription.Status.CANCELLED)


class QuotaTests(TestCase):
    def test_over_quota_blocks_create(self):
        user = User.objects.create_user(email="q@x.com", password="pass12345")
        user.daily_gen_quota = 0
        user.save(update_fields=["daily_gen_quota"])
        self.client.force_login(user)
        with patch("games.views.validate_prompt"):
            r = self.client.post("/create", {"prompt": "a snake game"})
        self.assertEqual(r.status_code, 302)
        self.assertIn("/account/billing", r.headers["Location"])
