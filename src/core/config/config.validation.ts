import * as Joi from 'joi';

export const configValidationSchema = Joi.object({
  DATABASE_URL: Joi.string().required(),

  // Secrets must be strong and explicitly provided — no insecure fallbacks.
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('1h'),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  // Optional comma-separated CORS allow-list (e.g. "https://app.example.com").
  CORS_ORIGINS: Joi.string().optional().allow(''),

  // App URLs (required for Paystack redirect callbacks; optional elsewhere).
  WEB_APP_URL: Joi.string().uri().optional().allow(''),
  MARKETING_URL: Joi.string().uri().optional().allow(''),
  APP_URL: Joi.string().uri().optional().allow(''),
  API_URL: Joi.string().uri().optional().allow(''),

  // ---- Phase 3.9 Paystack subscriptions & payments ----
  // Secret key is optional in dev so the API boots without a sandbox key; the
  // subscription module returns PAYMENTS_NOT_CONFIGURED until it is set to a
  // valid `sk_test_` / `sk_live_` value. Plan codes are created at
  // dashboard.paystack.com and mapped via env (never hardcoded).
  PAYSTACK_SECRET_KEY: Joi.string().optional().allow(''),
  PAYSTACK_BASIC_MONTHLY_PLAN_CODE: Joi.string().optional().allow(''),
  PAYSTACK_BASIC_ANNUAL_PLAN_CODE: Joi.string().optional().allow(''),
  PAYSTACK_PREMIUM_MONTHLY_PLAN_CODE: Joi.string().optional().allow(''),
  PAYSTACK_PREMIUM_ANNUAL_PLAN_CODE: Joi.string().optional().allow(''),

  // Free trial length (days) — 7 by default. Changing it only affects NEW
  // accounts and legacy trials yet to be created (never restarts active ones).
  TRIAL_DURATION_DAYS: Joi.number().integer().min(0).default(7),
  // Grace window (days) after a failed renewal before access expires — 3 by
  // default. During grace, the user is marked PAYMENT_FAILED but can still use
  // the app; after it, access lapses to EXPIRED (data is never deleted).
  SUBSCRIPTION_GRACE_PERIOD_DAYS: Joi.number()
    .integer()
    .min(0)
    .default(3),
  // Dev-only escape hatch: `true` bypasses the paywall for ALL requests.
  // Production must keep this unset / false.
  SUBSCRIPTION_DEV_BYPASS: Joi.boolean().default(false),

  PORT: Joi.number().default(3000),
}).unknown(true);
