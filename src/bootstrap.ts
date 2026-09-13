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

  // Handle root-level requests and favicon before applying global prefix
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.path === '/' && req.method === 'GET') {
      return res.json({ message: 'Routina API - Behavioral change system', status: 'running' });
    }
    if (req.path === '/favicon.ico') {
      return res.status(204).send();
    }
    next();
  });

  // Bound request body size to mitigate large-payload abuse. The raw body is
  // captured for Paystack webhook HMAC signature verification (the signature
  // is computed over the exact bytes Paystack sent).
  app.use(
    express.json({
      limit: '1mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use('/uploads', express.static('uploads'));

  // Reflect every request origin so credentialed browser requests are allowed.
  // A literal '*' cannot be used with credentials: true.
  app.enableCors({
    origin: true,
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
