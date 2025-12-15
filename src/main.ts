// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';

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
  'Access-Control-Request-Headers',
  'Access-Control-Request-Method',
  // Clerk / altre auth libs
  'X-Clerk-Auth',
  'Clerk-Auth',
];

const EXPOSE_HEADERS = ['Content-Disposition'];

async function bootstrap() {
  // ❌ niente CORS automatico di Nest, lo gestiamo noi
  const app = await NestFactory.create(AppModule, { cors: false });

  // Se sei dietro proxy (ngrok, nginx, cloudflare ecc.)
  if (typeof (app as any).set === 'function') {
    (app as any).set('trust proxy', 1);
  }

  // ✅ CORS unico per tutte le richieste
  app.use((req: any, res: any, next: any) => {
    const origin = req.headers.origin as string | undefined;

    if (origin) {
      // IMPORTANTISSIMO: nessun '*', echo esatto dell’origin
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    // Se non c'è Origin (es. Postman), non mettiamo proprio il header

    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', METHODS.join(','));
    res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS.join(','));
    res.setHeader('Access-Control-Expose-Headers', EXPOSE_HEADERS.join(','));
    res.setHeader('Access-Control-Max-Age', '86400');

    if (req.method === 'OPTIONS') {
      // Preflight finisce qui
      return res.sendStatus(204);
    }

    return next();
  });

  // Validation globale
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = 3000;

  // Ascolta su tutte le interfacce (IPv4)
  await app.listen(port, '0.0.0.0');

  Logger.log(`API listening on http://0.0.0.0:${port}`);
  Logger.log('CORS: dynamic origin, credentials allowed, wildcard disabilitato');
}

bootstrap();
