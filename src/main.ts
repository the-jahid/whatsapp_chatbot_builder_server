// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';

type OriginFn = import('@nestjs/common/interfaces/external/cors-options.interface').CorsOptions['origin'];

function getAllowedOrigins(): string[] {
  const raw =
    process.env.CORS_ORIGINS ??
    // dev defaults
    'http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function compileOriginPattern(origin: string): string | RegExp {
  if (!origin.includes('*')) return origin;
  const esc = origin
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\*/g, '[^.]+'); // wildcard subdomain
  return new RegExp(`^${esc}$`, 'i');
}

function buildCorsOrigin(): { origin: OriginFn | true; allowAll: boolean; list: string[] } {
  const list = getAllowedOrigins();

  // Explicit "allow all"
  const hasStar = list.some(o => o === '*' || o === '/*' || o.toLowerCase() === 'all');
  if (hasStar) {
    return { origin: true, allowAll: true, list };
  }

  const matchers = list.map(compileOriginPattern);
  const origin: OriginFn = (reqOrigin, cb) => {
    if (!reqOrigin) return cb(null, true); // server-to-server / no Origin
    const ok = matchers.some(m => (typeof m === 'string' ? m === reqOrigin : (m as RegExp).test(reqOrigin)));
    return ok ? cb(null, true) : cb(new Error(`Origin ${reqOrigin} not allowed by CORS`), false);
  };

  return { origin, allowAll: false, list };
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false });

  // Behind proxy (Render/Heroku). Needed if you ever use cookies.
  // @ts-ignore
  if (typeof app.set === 'function') app.set('trust proxy', 1);

  const METHODS = ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'];
  const ALLOWED_HEADERS = [
    'Content-Type',
    'Authorization',
    'Accept',
    'X-Requested-With',
    'X-CSRF-Token',
    'Origin',
    'Referer',
    'Sec-Fetch-Mode',
    'Sec-Fetch-Site',
    // Clerk/other auth libs sometimes send custom headers; add here if needed:
    'X-Clerk-Auth',
    'Clerk-Auth',
  ];
  const EXPOSE_HEADERS = ['Content-Disposition'];

  const { origin, allowAll, list } = buildCorsOrigin();

  // Primary CORS (handles normal preflights)
  app.enableCors({
    origin,                                  // function matcher or reflect
    credentials: allowAll ? false : true,    // cannot be true when allowing "*"
    methods: METHODS,
    allowedHeaders: ALLOWED_HEADERS,
    exposedHeaders: EXPOSE_HEADERS,
    maxAge: 86400,
    optionsSuccessStatus: 204,
    preflightContinue: false,
  });

  // Fallback: ensure ANY stray OPTIONS still returns valid CORS headers
  app.use((req: any, res: any, next: any) => {
    const reqOrigin = req.headers.origin as string | undefined;

    // Decide the response origin we’ll echo back
    let allowOrigin: string | undefined;
    if (!reqOrigin) {
      allowOrigin = list[0]; // arbitrary, won’t be used by browsers w/o Origin
    } else if (list.includes('*') || list.map(compileOriginPattern).some(m =>
      typeof m === 'string' ? m === reqOrigin : (m as RegExp).test(reqOrigin)
    )) {
      allowOrigin = reqOrigin;
    }

    if (allowOrigin) {
      res.header('Access-Control-Allow-Origin', allowOrigin);
      res.header('Vary', 'Origin');
    }
    res.header('Access-Control-Allow-Credentials', allowAll ? 'false' : 'true');
    res.header('Access-Control-Allow-Methods', METHODS.join(','));
    res.header('Access-Control-Allow-Headers', ALLOWED_HEADERS.join(','));
    res.header('Access-Control-Expose-Headers', EXPOSE_HEADERS.join(','));
    res.header('Access-Control-Max-Age', '86400');

    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  });

  // Validation
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '0.0.0.0';
  await app.listen(port, host);

  Logger.log(
    `API listening on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`
  );
  Logger.log(`CORS origins: ${list.length ? list.join(', ') : '(none)'}`);
}

bootstrap();
