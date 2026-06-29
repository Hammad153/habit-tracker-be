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

  PORT: Joi.number().default(3000),
}).unknown(true);
