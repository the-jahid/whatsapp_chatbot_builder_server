import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';

function parseOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS
    ?? 'http://localhost:3000,http://localhost:3001';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false });

  // If you’re behind a proxy and use cookies/sessions
  // (safe to keep; no-op otherwise)
  // @ts-ignore
  if (typeof app.set === 'function') app.set('trust proxy', 1);

  const ALLOWED_ORIGINS = parseOrigins();
  const METHODS = ['GET','HEAD','PUT','PATCH','POST','DELETE','OPTIONS'];
  const HEADERS = ['Content-Type','Authorization','Accept','X-Requested-With'];

  // Primary CORS setup (handles preflight automatically)
  app.enableCors({
    origin: (origin, cb) => {
      // allow same-origin / server-to-server (no Origin header)
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error(`Origin ${origin} not allowed by CORS`), false);
    },
    methods: METHODS,
    allowedHeaders: HEADERS,
    credentials: true,
    maxAge: 86400, // cache preflight
  });

  // Optional: extra safety for proxies that strip automatic OPTIONS handling.
  // This ensures any unmatched OPTIONS request still gets a proper CORS reply.
  app.use((req, res, next) => {
    const reqOrigin = req.headers.origin as string | undefined;
    const allowOrigin = reqOrigin && ALLOWED_ORIGINS.includes(reqOrigin)
      ? reqOrigin
      : ALLOWED_ORIGINS[0];

    if (allowOrigin) {
      res.header('Access-Control-Allow-Origin', allowOrigin);
      res.header('Vary', 'Origin');
    }
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Headers', HEADERS.join(','));
    res.header('Access-Control-Allow-Methods', METHODS.join(','));

    if (req.method === 'OPTIONS') {
      return res.status(204).send(); // preflight OK
    }
    next();
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = Number(process.env.PORT ?? 3000)
  await app.listen(port);
  Logger.log(`API listening on http://localhost:${port}`);
  Logger.log(`CORS origins: ${parseOrigins().join(', ')}`);
}
bootstrap()



