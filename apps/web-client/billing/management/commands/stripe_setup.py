"""One-time helper: create the Pro product + monthly/yearly recurring prices in
Stripe and print the price ids to paste into ``.env``.

    python manage.py stripe_setup

Idempotent by lookup_key: re-running reuses the same prices instead of piling up
duplicates. Amounts default to the plan catalog ($15/mo, $144/yr).
"""

from __future__ import annotations

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

MONTHLY_LOOKUP = "codply_pro_monthly"
YEARLY_LOOKUP = "codply_pro_yearly"


class Command(BaseCommand):
    help = "Create/ensure the Pro product and prices in Stripe; print their ids."

    def add_arguments(self, parser):
        parser.add_argument("--monthly-cents", type=int, default=1500)
        parser.add_argument("--yearly-cents", type=int, default=14400)
        parser.add_argument("--currency", default="usd")

    def handle(self, *args, **opts):
        if not settings.STRIPE_SECRET_KEY:
            raise CommandError("STRIPE_SECRET_KEY is not set — configure it in .env first.")
        import stripe

        stripe.api_key = settings.STRIPE_SECRET_KEY

        product = self._ensure_product(stripe)
        monthly = self._ensure_price(
            stripe, product, MONTHLY_LOOKUP, "month",
            opts["monthly_cents"], opts["currency"], "Pro Monthly",
        )
        yearly = self._ensure_price(
            stripe, product, YEARLY_LOOKUP, "year",
            opts["yearly_cents"], opts["currency"], "Pro Yearly",
        )

        self.stdout.write(self.style.SUCCESS("\nStripe Pro plan is ready. Add to .env:\n"))
        self.stdout.write(f"STRIPE_PRICE_PRO_MONTHLY={monthly.id}")
        self.stdout.write(f"STRIPE_PRICE_PRO_YEARLY={yearly.id}")
        self.stdout.write(
            "\nNext: start the CLI listener to get STRIPE_WEBHOOK_SECRET:\n"
            "  stripe listen --forward-to localhost:8001/api/v1/billing/stripe/webhook\n"
        )

    def _ensure_product(self, stripe):
        # Reuse an existing product tagged with our marker if present.
        try:
            found = stripe.Product.search(query="metadata['codply_plan']:'pro'", limit=1)
            if found.data:
                self.stdout.write(f"Reusing product {found.data[0].id}")
                return found.data[0]
        except Exception:  # search can be unavailable/eventually-consistent
            pass
        product = stripe.Product.create(
            name="Codply Pro",
            description="Pro subscription — monthly credit grant, bigger budgets, priority queue.",
            metadata={"codply_plan": "pro"},
        )
        self.stdout.write(f"Created product {product.id}")
        return product

    def _ensure_price(self, stripe, product, lookup_key, interval,
                      unit_amount, currency, nickname):
        existing = stripe.Price.list(lookup_keys=[lookup_key], limit=1)
        if existing.data:
            self.stdout.write(f"Reusing price {existing.data[0].id} ({lookup_key})")
            return existing.data[0]
        price = stripe.Price.create(
            product=product.id,
            unit_amount=unit_amount,
            currency=currency,
            recurring={"interval": interval},
            nickname=nickname,
            lookup_key=lookup_key,
        )
        self.stdout.write(f"Created price {price.id} ({lookup_key})")
        return price
