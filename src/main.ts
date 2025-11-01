// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';

/**
 * Parse CORS_ORIGINS from env.
 * - CSV list (comma-separated)
 * - Supports wildcards like https://*.example.com
 * - Defaults to localhost dev ports
 */
function getAllowedOrigins(): string[] {
  const raw =
    process.env.CORS_ORIGINS ??
    'http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Convert a single origin pattern to a RegExp matcher if it contains "*".
 * Otherwise return the exact string.
 */
function compileOriginPattern(origin: string): string | RegExp {
  if (!origin.includes('*')) return origin;
  // Escape regex specials, then replace \* with [^.]+ (subdomain wildcard)
  const esc = origin.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '[^.]+');
  return new RegExp(`^${esc}$`, 'i');
}

/**
 * Build the origin option for enableCors. Handles:
 *  - exact matches
 *  - wildcard subdomains
 *  - "*" (allow all) with credentials=false (per CORS spec)
 */
function buildCorsOriginOption() {
  const list = getAllowedOrigins();

  // If user explicitly provided "*" anywhere, allow all (credentials must be false)
  const hasStar = list.some((o) => o === '*' || o === '/*' || o.toLowerCase() === 'all');
  if (hasStar) {
    return {
      origin: true as const, // reflect request origin
      allowAll: true,
    };
  }

  const matchers = list.map(compileOriginPattern);

  // Predicate used by Nest/Express CORS
  const originFn: import('@nestjs/common/interfaces/external/cors-options.interface').CorsOptions['origin'] =
    (reqOrigin, cb) => {
      // server-to-server or same-origin requests (no Origin header)
      if (!reqOrigin) return cb(null, true);

      // exact string matchers
      if (matchers.some((m) => (typeof m === 'string' ? m === reqOrigin : (m as RegExp).test(reqOrigin)))) {
        return cb(null, true);
      }

      return cb(new Error(`Origin ${reqOrigin} not allowed by CORS`), false);
    };

  return { origin: originFn, allowAll: false };
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false });

  // If you’re behind a proxy (Render/Heroku/etc.) and use cookies/sessions.
  // Works with Express adapter.
  // @ts-ignore
  if (typeof app.set === 'function') app.set('trust proxy', 1);

  const METHODS = ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'];
  const ALLOWED_HEADERS = [
    'Content-Type',
    'Authorization',
    'Accept',
    'X-Requested-With',
    'X-CSRF-Token',
  ];
  const EXPOSE_HEADERS = ['Content-Disposition']; // add if you serve file downloads

  const { origin, allowAll } = buildCorsOriginOption();

  app.enableCors({
    origin, // exact/regex predicate OR true (reflect)
    methods: METHODS.join(','),
    allowedHeaders: ALLOWED_HEADERS.join(','),
    exposedHeaders: EXPOSE_HEADERS.join(','),
    credentials: allowAll ? false : true, // cannot be true when allowing all origins
    maxAge: 86400, // cache preflight for 24h
    optionsSuccessStatus: 204,
    preflightContinue: false,
  });

  // Global validation
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Listen like a PaaS (Render) expects
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '0.0.0.0';
  await app.listen(port, host);

  const allowed = getAllowedOrigins().join(', ') || '(none)';
  Logger.log(`API listening on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  Logger.log(`CORS enabled. Allowed origins: ${allowed}`);
}

bootstrap();
