import 'reflect-metadata';

import { Logger as NestLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { TypedConfigService } from './common/config/index';
import { GlobalZodValidationPipe } from './common/pipes/zod-validation.pipe';

async function bootstrap(): Promise<void> {
  // bodyParser: false — собственный JSON-парсер с `verify`, который сохраняет
  // сырой Buffer тела в `req.rawBody` (нужно для HMAC-подписей Crossmark и
  // для верификации LiveKit-вебхуков). Парсинг `req.body` остаётся прежним.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  // Tochka шлёт webhook JWT-строкой (Content-Type: application/jose / text/plain
  // / application/x-www-form-urlencoded). Подключаем express.text() ТОЛЬКО для
  // webhook-эндпоинта Точки, до общего express.json() — чтобы JWT-строка
  // долетела в @Body() как string. См. ТЗ billing-tochka-referral-dadata-z §16.1.
  app.use(
    '/api/v1/internal/billing/provider-events',
    express.text({ type: '*/*', limit: '1mb' }),
  );

  app.use(
    express.json({
      limit: '1mb',
      // LiveKit шлёт вебхуки с Content-Type: application/webhook+json — без этого
      // express.json его не парсит, rawBody не сохраняется и sha256-проверка падает.
      type: ['application/json', 'application/webhook+json'],
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  const cfg = app.get(TypedConfigService);

  // ── базовая безопасность ────────────────────────────────────────────────
  app.use(cookieParser());
  app.use(
    helmet({
      contentSecurityPolicy: cfg.runtime.isProduction
        ? {
            directives: {
              defaultSrc: [`'self'`],
              // 'unsafe-inline' нужен для inline-скриптов Next.js RSC.
              scriptSrc: [`'self'`, `'unsafe-inline'`],
              styleSrc: [`'self'`, `'unsafe-inline'`],
              imgSrc: [`'self'`, 'blob:', 'data:', 'https:'],
              mediaSrc: [`'self'`, 'blob:'],
              connectSrc: [
                `'self'`,
                cfg.auth.publicFrontendUrl,
                cfg.livekit.apiUrl,
                'wss://*.crossmark.ru',
              ],
              frameAncestors: [`'none'`],
              objectSrc: [`'none'`],
              baseUri: [`'self'`],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
      // HSTS включаем только в prod (за TLS-терминатором nginx).
      strictTransportSecurity: cfg.runtime.isProduction
        ? { maxAge: 63072000, includeSubDomains: true, preload: false }
        : false,
      // X-Frame-Options: DENY — двойная защита помимо CSP frame-ancestors.
      frameguard: { action: 'deny' },
      // X-Content-Type-Options: nosniff — включается по умолчанию, явно.
      noSniff: true,
    }),
  );

  app.enableCors({
    origin: cfg.cors.allowed,
    credentials: true,
  });

  // ── глобальные пайпы ───────────────────────────────────────────────────
  // AllExceptionsFilter регистрируется через APP_FILTER в AppModule,
  // чтобы получить через DI PinoLogger.
  app.useGlobalPipes(new GlobalZodValidationPipe());

  // ── Swagger ─────────────────────────────────────────────────────────────
  // Swagger включаем только в dev. В prod защищается basic-auth middleware'ом.
  if (!cfg.runtime.isProduction) {
    try {
      // Internal API — все controllers (cookie + bearer auth).
      const swaggerConfig = new DocumentBuilder()
        .setTitle('Z Backend API')
        .setDescription('Z — память компании. Backend API. MVP-вертикаль — AI-встречи на LiveKit.')
        .setVersion('0.1.0')
        .addCookieAuth('session')
        .addBearerAuth()
        .build();
      const document = SwaggerModule.createDocument(app, swaggerConfig);
      SwaggerModule.setup('api/docs', app, document, {
        swaggerOptions: { persistAuthorization: true },
      });

      // Public REST API (M3c) — отдельный документ, только endpoints под
      // `/api/public/v1`. Предназначен для внешних интеграций по API-ключам.
      const publicSwaggerConfig = new DocumentBuilder()
        .setTitle('Z Public API')
        .setDescription(
          'Public REST API. Авторизация: Bearer <API key из /api/v1/api-keys>.',
        )
        .setVersion('1.0.0')
        .addBearerAuth({
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'API Key',
        })
        .addServer('/api/public/v1')
        .build();
      const publicDocument = SwaggerModule.createDocument(app, publicSwaggerConfig, {
        include: [],
        // Включаем только controllers под `/api/public/v1`.
        deepScanRoutes: true,
        operationIdFactory: (controllerKey: string, methodKey: string) =>
          `${controllerKey}_${methodKey}`,
      });
      // Фильтруем paths, оставляя только публичные.
      publicDocument.paths = Object.fromEntries(
        Object.entries(publicDocument.paths).filter(([path]) =>
          path.startsWith('/api/public/v1'),
        ),
      );
      SwaggerModule.setup('api/public/v1/docs', app, publicDocument, {
        swaggerOptions: { persistAuthorization: true },
      });
    } catch (err) {
      new NestLogger('Bootstrap').warn(
        `Swagger недоступен: ${(err as Error).message}. Пропускаем.`,
      );
    }
  }

  // ── graceful shutdown ───────────────────────────────────────────────────
  app.enableShutdownHooks();

  // ── запуск ──────────────────────────────────────────────────────────────
  await app.listen(cfg.port);
  const url = await app.getUrl();
  new NestLogger('Bootstrap').log(`Application is running on: ${url}`);
}

bootstrap().catch((err: unknown) => {
  // Если до получения логгера упали — пишем в stderr.
   
  console.error('[bootstrap] Не удалось запустить приложение:', err);
  process.exit(1);
});
