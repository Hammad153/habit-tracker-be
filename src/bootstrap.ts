import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import helmet from 'helmet';
import * as express from 'express';
import { AllExceptionFilter } from './all-exception.filter';

/**
 * Single, shared application configuration used by every entry point
 * (local `main.ts`, Vercel `api/index.ts`, and AWS Lambda `serverless.ts`).
 *
 * Keeping this in one place guarantees the security middleware, validation,
 * error handling and routing prefix can never drift between deployment targets.
 */
export function configureApp(app: INestApplication): void {
  const { httpAdapter } = app.get(HttpAdapterHost);

  // Security headers (CSP, X-Frame-Options, no-sniff, HSTS, etc.)
  app.use(helmet());

  // Bound request body size to mitigate large-payload abuse.
  app.use(express.json({ limit: '1mb' }));
  app.use('/uploads', express.static('uploads'));

  // CORS: restrict to an explicit allow-list when configured, otherwise reflect
  // the request origin (native mobile clients send no Origin header, so this is
  // safe for the app; web deployments should set CORS_ORIGINS).
  const origins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins.length ? origins : true,
    credentials: true,
  });

  app.useGlobalFilters(new AllExceptionFilter(httpAdapter));

  // Global input validation. `whitelist` strips properties not declared on the
  // DTO (closes mass-assignment / object-injection), `transform` coerces
  // payloads into the DTO classes.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix('api/v1');
}
