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
import { RedisIoAdapter } from './common/ws/redis-io.adapter';
import { DbLoggerBridge } from './modules/logging/db-logger.bridge';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    bufferLogs: true,
  });

  app.useLogger(app.get(DbLoggerBridge));

  app.use('/api/v1/internal/billing/provider-events', express.text({ type: '*/*', limit: '1mb' }));

  app.use(
    express.json({
      limit: '1mb',
      type: ['application/json', 'application/webhook+json'],
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  const cfg = app.get(TypedConfigService);

  app.use(cookieParser());
  app.use(
    helmet({
      contentSecurityPolicy: cfg.runtime.isProduction
        ? {
            directives: {
              defaultSrc: [`'self'`],
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
      strictTransportSecurity: cfg.runtime.isProduction
        ? { maxAge: 63072000, includeSubDomains: true, preload: false }
        : false,
      frameguard: { action: 'deny' },
      noSniff: true,
    }),
  );

  app.enableCors({
    origin: cfg.cors.allowed,
    credentials: true,
  });

  app.useGlobalPipes(new GlobalZodValidationPipe());

  if (!cfg.runtime.isProduction) {
    try {
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

      const publicSwaggerConfig = new DocumentBuilder()
        .setTitle('Z Public API')
        .setDescription('Public REST API. Авторизация: Bearer <API key из /api/v1/api-keys>.')
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
        deepScanRoutes: true,
        operationIdFactory: (controllerKey: string, methodKey: string) =>
          `${controllerKey}_${methodKey}`,
      });
      publicDocument.paths = Object.fromEntries(
        Object.entries(publicDocument.paths).filter(([path]) => path.startsWith('/api/public/v1')),
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

  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  app.enableShutdownHooks();

  await app.listen(cfg.port);
  const url = await app.getUrl();
  new NestLogger('Bootstrap').log(`Application is running on: ${url}`);
}

bootstrap().catch((err: unknown) => {
  console.error('[bootstrap] Не удалось запустить приложение:', err);
  process.exit(1);
});
