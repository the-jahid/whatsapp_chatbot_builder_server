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
  // disable Nest auto-CORS, we configure manually
  const app = await NestFactory.create(AppModule, { cors: false });

  // Behind proxy (Render/Heroku/etc) – useful if you ever use cookies
  if (typeof (app as any).set === 'function') {
    (app as any).set('trust proxy', 1);
  }

  /** Allow ANY origin (the cors lib will echo back the request origin) */
  const origin: OriginFn = (_reqOrigin, cb) => {
    cb(null, true); // always allow
  };

  // Primary CORS (handles normal browser preflights)
  app.enableCors({
    origin,                 // allow any origin, reflected back
    credentials: true,      // allow cookies / Authorization header
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

  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '0.0.0.0';

  await app.listen(port, host);

  Logger.log(
    `API listening on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`,
  );
  Logger.log('CORS: allowing ALL origins');
}

bootstrap();
