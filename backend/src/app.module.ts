import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';

import { ConfigModule } from './common/config/index';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggerModule } from './common/logger/logger.module';
import { MetricsModule } from './common/metrics/metrics.module';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { AdminModule } from './modules/admin/admin.module';
import { AiModule } from './modules/ai/ai.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { CrossmarkModule } from './modules/integrations-crossmark/crossmark.module';
import { LivekitModule } from './modules/livekit/livekit.module';
import { MeetingsModule } from './modules/meetings/meetings.module';
import { ParticipantsModule } from './modules/participants/participants.module';
import { RecordingsModule } from './modules/recordings/recordings.module';
import { RetentionModule } from './modules/retention/retention.module';
import { UsersModule } from './modules/users/users.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';

@Module({
  imports: [
    // Глобальный конфиг — должен идти ПЕРВЫМ, чтобы валидация ENV выполнилась
    // до любых других модулей, зависящих от значений.
    ConfigModule,

    // Pino-логгер. В dev — pretty, в prod — json. requestId — из middleware.
    LoggerModule,

    // Prometheus-метрики (`/metrics`) + кастомные business-метрики.
    MetricsModule,

    // Cron — для retention/idle-meeting jobs (используется со следующих фаз).
    ScheduleModule.forRoot(),

    // Глобальный rate-limiter. Конкретные лимиты на эндпоинтах
    // настраиваются через `@Throttle()` декоратор.
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 120,
      },
    ]),

    // Глобальные модули инфраструктуры.
    PrismaModule,
    RedisModule,

    // Глобальный модуль пользователей — должен подняться ДО AuthModule, так как
    // AuthController (внутри AuthModule) зависит от UsersService.
    UsersModule,

    // Глобальный auth-модуль (JwtService, HmacService, Cookie/Hmac/Admin guards).
    AuthModule,

    // LiveKit-обёртка. Глобальный модуль — нужен в Participants/Meetings/Webhooks.
    LivekitModule,

    // AI-pipeline (HTTP-side). Содержит `AiQueueService` (диспетчер очередей)
    // и `RetryService`. Сами воркеры — в отдельном `WorkersModule`.
    AiModule,

    // Бизнес-модули.
    HealthModule,
    MeetingsModule,
    ParticipantsModule,
    // RecordingsModule — должен подняться ДО WebhooksModule, т.к.
    // LivekitEventsHandler инжектит RecordingsService.
    RecordingsModule,
    WebhooksModule,
    // Retention cron — нужен S3Service из RecordingsModule.
    RetentionModule,

    // Phase 8 — admin endpoints + дополнительные Crossmark endpoints.
    AdminModule,
    CrossmarkModule,
  ],
  providers: [
    // Фильтр зарегистрирован через DI, чтобы получить PinoLogger.
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');

    // NB: сохранение `req.rawBody` для всех запросов — глобально через
    // `express.json({ verify })` в `main.ts`. Это нужно для проверки HMAC-
    // подписей Crossmark-интеграции и LiveKit-вебхуков. Парсинг `req.body`
    // продолжает работать как раньше.
  }
}
