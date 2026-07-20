# Stripe payments — setup & runbook

Self-serve **Pro** subscriptions run on Stripe Checkout. The rule that fixes the
original bug (accounts upgrading to Pro without paying):

> **A user is upgraded to Pro only by the signature-verified webhook, after
> Stripe confirms payment — never on the checkout redirect, and never for free.**

If Stripe isn't configured, the upgrade CTA is hidden (`checkout_available=false`)
and the checkout endpoint refuses. There is no "grant Pro for free" path.

## Architecture

| Piece | Where |
|-------|-------|
| Raw Stripe I/O (session create, event verify/dispatch) | [apps/web-client/billing/stripe_gateway.py](../apps/web-client/billing/stripe_gateway.py) |
| Entitlement rules (activate/downgrade/past-due, credit grant) | [apps/web-client/billing/services.py](../apps/web-client/billing/services.py) |
| Checkout endpoint `POST /api/v1/me/subscription/checkout` | [apps/web-client/api/views_me.py](../apps/web-client/api/views_me.py) |
| Webhook `POST /api/v1/billing/stripe/webhook` (CSRF-exempt, signed) | [apps/web-client/api/views_billing.py](../apps/web-client/api/views_billing.py) |
| Product/price bootstrap command | [apps/web-client/billing/management/commands/stripe_setup.py](../apps/web-client/billing/management/commands/stripe_setup.py) |

### Flow

1. Upgrade dialog → `POST /me/subscription/checkout {plan:"pro", interval:"monthly"|"yearly"}`.
2. Server creates a **subscription-mode Checkout Session** (correct price,
   `client_reference_id = user.id`, success/cancel URLs) → returns `{url}`.
3. Browser is redirected to Stripe's hosted page (the React `PricingDialog`
   already handles the cross-origin `url`). The user pays there.
4. Stripe → `checkout.session.completed` webhook → signature verified →
   **only now** the user is set to Pro, credits granted, Stripe customer +
   subscription ids stored. Idempotent per (subscription, billing period).
5. Lifecycle: `invoice.paid` renews + re-grants; `invoice.payment_failed` →
   `past_due`; `customer.subscription.deleted` → back to Free.

## One-time setup (test / sandbox)

All commands run from `apps/web-client` with its venv (`make setup` first).

### 1. Keys

In `apps/web-client/.env` (gitignored):

```
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
```

> ⚠️ If a secret key was ever shared in plaintext (chat, ticket, commit), **roll
> it** in the Stripe Dashboard → Developers → API keys → *Roll key*, and paste
> the new value here before going further.

### 2. Create the Pro product + prices

```bash
.venv/bin/python manage.py stripe_setup
```

Prints the two price ids — paste them into `.env`:

```
STRIPE_PRICE_PRO_MONTHLY=price_...
STRIPE_PRICE_PRO_YEARLY=price_...
```

Defaults are `$15/mo` and `$144/yr` (override with `--monthly-cents` /
`--yearly-cents` / `--currency`). Re-running reuses the same product/prices
(idempotent by `lookup_key`).

### 3. Webhook signing secret (local dev via Stripe CLI)

```bash
stripe login
stripe listen --forward-to localhost:8001/api/v1/billing/stripe/webhook
```

Copy the `whsec_...` it prints into `.env`:

```
STRIPE_WEBHOOK_SECRET=whsec_...
```

Keep `stripe listen` running while testing. Restart Django after editing `.env`.

### 4. Migrate & run

```bash
make migrate-web     # applies billing 0002 (external_subscription_id / price)
make dev-web         # http://localhost:8001
```

## Test the end-to-end flow

1. Sign in, open **Account → Billing → Upgrade**, pick monthly/yearly, *Get started*.
2. On Stripe's page use test card `4242 4242 4242 4242`, any future expiry/CVC/ZIP.
3. You're returned to `/account/billing?checkout=success`. Within a second or two
   the `stripe listen` window shows `checkout.session.completed → 200` and the
   plan flips to **Pro** with the credit grant.

Trigger lifecycle events manually if needed:

```bash
stripe trigger checkout.session.completed
stripe trigger invoice.payment_failed
stripe trigger customer.subscription.deleted
```

Test cards: <https://docs.stripe.com/testing>. Card `4000 0000 0000 0341` fails
after attaching; `4000 0000 0000 9995` is declined.

## Production notes

- Create a **live-mode** webhook endpoint in the Dashboard pointing at
  `https://<host>/api/v1/billing/stripe/webhook`; use its signing secret.
- Set `STRIPE_RETURN_BASE_URL=https://<host>` so success/cancel URLs are absolute
  and correct behind a proxy.
- Subscribe the endpoint to at least: `checkout.session.completed`,
  `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`,
  `customer.subscription.deleted`.
- The webhook must stay CSRF-exempt and unauthenticated — its trust is the
  signature. Never add `login_required` to it.
