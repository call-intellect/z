import 'reflect-metadata';

import { Logger as NestLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { TypedConfigService } from './common/config/index';
import { GlobalZodValidationPipe } from './common/pipes/zod-validation.pipe';

async function bootstrap(): Promise<void> {
  // bodyParser: false — собственный JSON-парсер с `verify`, который сохраняет
  // сырой Buffer тела в `req.rawBody` (нужно для HMAC-подписей Crossmark и
  // для верификации LiveKit-вебхуков). Парсинг `req.body` остаётся прежним.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });

  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Pino-логгер — глобально вместо стандартного Nest-логгера.
  app.useLogger(app.get(Logger));

  const cfg = app.get(TypedConfigService);

  // ── базовая безопасность ────────────────────────────────────────────────
  app.use(cookieParser());
  app.use(
    helmet({
      contentSecurityPolicy: cfg.runtime.isProduction
        ? {
            directives: {
              defaultSrc: [`'self'`],
              scriptSrc: [`'self'`],
              styleSrc: [`'self'`, `'unsafe-inline'`],
              imgSrc: [`'self'`, 'data:', 'https:'],
              connectSrc: [`'self'`, cfg.auth.publicFrontendUrl, cfg.livekit.apiUrl],
              frameAncestors: [`'none'`],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
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
      const swaggerConfig = new DocumentBuilder()
        .setTitle('Z Backend API')
        .setDescription('API для AI-видеовстреч на LiveKit')
        .setVersion('0.1.0')
        .addCookieAuth('session')
        .addBearerAuth()
        .build();
      const document = SwaggerModule.createDocument(app, swaggerConfig);
      SwaggerModule.setup('api/docs', app, document, {
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
  // eslint-disable-next-line no-console
  console.error('[bootstrap] Не удалось запустить приложение:', err);
  process.exit(1);
});
