// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  // Force restart to load env vars
  // 1. Create the app WITHOUT passing { cors: ... } here.
  // We will handle CORS manually below.
  const app = await NestFactory.create(AppModule);

  // 2. Enable CORS with specific options.
  // We use a dynamic callback for 'origin' to be robust against trailing slashes.
  app.enableCors({
    origin: (requestOrigin, callback) => {
      const allowedOrigins = [
        'http://localhost:3001',
        'http://localhost:3000',
        'https://wapzen.io',
        'https://www.wapzen.io',
        'https://9b90be51bd86.ngrok-free.app',
      ];

      // Allow subdomains for production
      const allowedPatterns = [
        /^https:\/\/.*\.wapzen\.io$/,
      ];

      // Allow requests with no origin (like mobile apps or curl requests)
      if (!requestOrigin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(requestOrigin) || allowedPatterns.some(pattern => pattern.test(requestOrigin))) {
        callback(null, true);
      } else {
        Logger.warn(`[CORS] Blocked request from: ${requestOrigin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true, // This enables cookies/auth headers
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');

  Logger.log(`API listening on http://0.0.0.0:${port}`);
  Logger.log(`CORS is enabled for: http://localhost:3001`);
}

bootstrap();