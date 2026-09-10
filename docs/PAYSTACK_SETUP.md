# Paystack Setup & Subscription Operations (Phase 3.9)

Routina sells 4 recurring plans through Paystack (NGN). All recurring billing is
**Paystack-native** — we initialize a Plan-backed transaction, Paystack creates
the customer subscription, and its webhooks drive our state. We never build a
custom recurring-billing engine, and pricing lives centrally in
`src/module/subscription/plans.config.ts` (exposed to clients via
`GET /subscription/plans`).

| Plan id | Price | Paystack amount (kobo) |
|---|---|---|
| `BASIC_MONTHLY` | ₦1,500/mo | 150000 |
| `BASIC_YEARLY` | ₦15,000/yr (saves ₦3,000) | 1500000 |
| `PREMIUM_MONTHLY` | ₦3,000/mo | 300000 |
| `PREMIUM_YEARLY` | ₦30,000/yr (saves ₦6,000) | 3000000 |

> **Trial:** every account gets one 7-day trial at signup (`TRIAL_DURATION_DAYS`).
> When it expires the account moves to `EXPIRED` and the paywall blocks usage.
> **Data is never deleted** — the user just loses access and can re-subscribe.

## 1. Create a Paystack account

- Sign up at <https://dashboard.paystack.com> (Nigeria). Complete upgrade for live, use **Test mode** for development.
- In Settings → API Keys & Webhooks, switch to the **Test key** section while developing.

## 2. Set the secret key

Backend env:

```
PAYSTACK_SECRET_KEY="sk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

The value must start with `sk_test_` (dev) or `sk_live_` (prod) or checkout
refuses to run (`PAYMENTS_NOT_CONFIGURED`). It is **server-only**; it never
reaches the mobile app or marketing site.

## 3. Create the four plans in Dashboard → Plans

For each plan click **"Create Plan"**:

1. **Name:** `Routina Basic Monthly` … and so on for all four.
2. **Amount:** the kobo value from the table above (Paystack displays it as ₦).
3. **Interval:** `Monthly` for the monthly plans, `Annual` for the yearly plans.
4. **Currency:** NGN (your account default).
5. Save, then open the plan and copy its **Plan code** (looks like `PLN_xxxxxx`).

## 4. Map plan codes in the environment

```
PAYSTACK_BASIC_MONTHLY_PLAN_CODE="PLN_xxx1"
PAYSTACK_BASIC_ANNUAL_PLAN_CODE="PLN_xxx2"
PAYSTACK_PREMIUM_MONTHLY_PLAN_CODE="PLN_xxx3"
PAYSTACK_PREMIUM_ANNUAL_PLAN_CODE="PLN_xxx4"
```

These env vars are the **only** place plan codes exist — the backend cannot
activate a plan whose code is unset, and it never guesses one. If a code
changes later, just update the env (a code change never revokes existing
subscriptions; Paystack keeps billing on the old code until they renew).

## 5. Register the webhook

In Settings → API Keys & Webhooks → **Webhook URL**, point to the API:

```
POST https://<your-api-host>/subscription/paystack/webhook
```

- The endpoint verifies `x-paystack-signature` (HMAC-SHA512 over the raw body
  with `PAYSTACK_SECRET_KEY`) — no secret is sent in the query string.
- Events handled: `charge.success`, `subscription.create`, `invoice.create`,
  `invoice.payment_failed`, `invoice.update`, `subscription.not_renew`,
  `subscription.disable`. Others are logged and ignored.
- Retries are safe: every event is stored idempotently keyed by
  `event:reference` and re-runs are skipped.
- The endpoint returns 200 immediately; heavy work runs afterwards.

## 6. Configure the app callback

In Paystack's plan settings your returned-to URL comes from the backend, which
uses `WEB_APP_URL`:

```
WEB_APP_URL="https://app.yourdomain.com"   # or exp://192.168.x.x:8081 in dev
```

After payment the user returns to `WEB_APP_URL/subscription/result?reference=…`
where the app calls `POST /subscription/verify` (server-side verification). The
webhook is the source of truth for renewals; the verify endpoint covers the
first payment even if the webhook is delayed.

## Common operational notes

- **Cancellation** (in-app → `POST /subscription/cancel`): we flip the plan to
  `NON_RENEWING` and `cancelAtPeriodEnd=true`; the user keeps access until the
  paid period ends. We also best-effort disable the Paystack subscription.
- **Failed renewals**: `invoice.payment_failed` marks the account
  `PAYMENT_FAILED` with a grace window
  (`SUBSCRIPTION_GRACE_PERIOD_DAYS`, default 3); after it elapses the account
  becomes `EXPIRED`. No data is removed.
- **Resuming**: `POST /subscription/resume` resets our flag. Paystack's
  `disable` is irreversible, so a disabled Paystack subscription resumes as a
  fresh checkout at the next cycle — local access continues in the meantime.
- **Standing out**: `SUBSCRIPTION_DEV_BYPASS=true` disables the paywall for
  every request. This is for preview builds only — never set it in production.
- **Testing**: use Paystack's test cards in your dashboard (e.g.
  `4084 0840 8408 4081`). A test transaction always succeeds; use the "Paystack
  test" cards for declined/failed flows to exercise `PAYMENT_FAILED` + grace.

## Where the money-flow code lives

- Central pricing/entitlements: `src/module/subscription/plans.config.ts`
- Paystack HTTP client: `src/module/subscription/paystack.service.ts`
- Checkout/verify/cancel/resume: `src/module/subscription/subscription.service.ts`
- Webhook handling: `src/module/subscription/webhook.service.ts`
- Global paywall guard: `src/module/subscription/subscription-access.guard.ts`
- Schema: `UserSubscription`, `PaymentTransaction`, `SubscriptionWebhookEvent`