// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';

type OriginFn =
  import('@nestjs/common/interfaces/external/cors-options.interface').CorsOptions['origin'];

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
  // Clerk / other auth libs
  'X-Clerk-Auth',
  'Clerk-Auth',
];

const EXPOSE_HEADERS = ['Content-Disposition'];

async function bootstrap() {
  // Create Nest app with CORS disabled (we configure it manually)
  const app = await NestFactory.create(AppModule, { cors: false });

  // Behind proxy (useful if you ever use cookies / X-Forwarded-For)
  if (typeof (app as any).set === 'function') {
    (app as any).set('trust proxy', 1);
  }

  /** Allow ANY origin (the cors lib will echo back the request origin) */
  const origin: OriginFn = (_reqOrigin, cb) => {
    cb(null, true); // always allow
  };

  // Primary CORS (handles normal browser preflights)
  app.enableCors({
    origin, // allow any origin, reflected back
    credentials: true, // allow cookies / Authorization header
    methods: METHODS,
    allowedHeaders: ALLOWED_HEADERS,
    exposedHeaders: EXPOSE_HEADERS,
    maxAge: 86400,
    optionsSuccessStatus: 204,
    preflightContinue: false,
  });

  // Extra safety: handle any stray OPTIONS + set headers on all responses
  app.use((req: any, res: any, next: any) => {
    const reqOrigin = req.headers.origin as string | undefined;

    if (reqOrigin) {
      // echo the caller origin (needed when credentials: true)
      res.header('Access-Control-Allow-Origin', reqOrigin);
      res.header('Vary', 'Origin');
    } else {
      // non-browser / no Origin header
      res.header('Access-Control-Allow-Origin', '*');
    }

    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', METHODS.join(','));
    res.header('Access-Control-Allow-Headers', ALLOWED_HEADERS.join(','));
    res.header('Access-Control-Expose-Headers', EXPOSE_HEADERS.join(','));
    res.header('Access-Control-Max-Age', '86400');

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }

    return next();
  });

  // Global validation
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // ---- LISTEN: no env vars, port fixed to 3000 ----
  const port = 3000;

  // NOTE: calling listen(port) with NO host:
  // on modern Linux + Node this binds to :: with ipv6Only=false,
  // so it accepts BOTH IPv4 and IPv6.
  await app.listen(port);

  Logger.log(`API listening on port ${port} (IPv4 + IPv6 if supported)`);
  Logger.log('CORS: allowing ALL origins');
}

bootstrap();
