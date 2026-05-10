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
import { AccountsModule } from './modules/accounts/accounts.module';
import { AdminModule } from './modules/admin/admin.module';
import { AiModule } from './modules/ai/ai.module';
import { AuthModule } from './modules/auth/auth.module';
import { ChaptersModule } from './modules/chapters/chapters.module';
import { HealthModule } from './modules/health/health.module';
import { HighlightsModule } from './modules/highlights/highlights.module';
import { CrossmarkModule } from './modules/integrations-crossmark/crossmark.module';
import { LivekitModule } from './modules/livekit/livekit.module';
import { MailModule } from './modules/mail/mail.module';
import { MeetingsModule } from './modules/meetings/meetings.module';
import { ParticipantsModule } from './modules/participants/participants.module';
import { RecordingsModule } from './modules/recordings/recordings.module';
import { RetentionModule } from './modules/retention/retention.module';
import { RoomMessagesModule } from './modules/room-messages/room-messages.module';
import { SharesModule } from './modules/shares/shares.module';
import { TagsModule } from './modules/tags/tags.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { UsersModule } from './modules/users/users.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
// M3c — cross-cutting ai-workspace модули.
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { AuditModule } from './modules/audit/audit.module';
import { CardsModule } from './modules/cards/cards.module';
import { ChatModule } from './modules/chat/chat.module';
import { CoreQueueModule } from './modules/core-queue/core-queue.module';
import { SearchModule } from './modules/search/search.module';
import { DestinationsModule } from './modules/destinations/destinations.module';
import { ExportsModule } from './modules/exports/exports.module';
import { IngestModule } from './modules/ingest/ingest.module';
import { OrgsModule } from './modules/orgs/orgs.module';
import { PublicApiModule } from './modules/public-api/public-api.module';
import { QuotasModule } from './modules/quotas/quotas.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { SecurityModule } from './modules/security/security.module';
import { WebhooksOutModule } from './modules/webhooks-out/webhooks-out.module';

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

    // Глобальный RBAC (Org / Membership) — RbacService + TenantGuard.
    // Должен быть ДО tenant-scoped модулей (Meetings/Cards/Tasks/etc),
    // которые могут использовать TenantGuard.
    RbacModule,

    // LiveKit-обёртка. Глобальный модуль — нужен в Participants/Meetings/Webhooks.
    LivekitModule,

    // knowledge-core (Фаза 1) — диспетчер очередей `core.*` (используется
    // IngestService). Должен быть ДО IngestModule.
    CoreQueueModule,

    // knowledge-core (Фаза 1) — IngestService + meeting-adapter +
    // POST /api/v1/ingest. Должен быть ДО AiModule, потому что AI-воркеры
    // в WorkersModule (отдельный процесс) дёргают MeetingIngestAdapter.
    // Здесь же глобальный модуль нужен и для HTTP API (раз RawEvents).
    IngestModule,

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

    // Standalone-product (Phase 2): lead-style регистрация, login, профиль,
    // forgot/reset password. Mail — глобальный, нужен и за пределами Accounts
    // (нотификации, в будущем — owner-уведомления).
    MailModule,
    // OrgsModule должен идти ДО AccountsModule, потому что AccountsService
    // импортирует OrgsService для хука в register (создание персонального Org).
    OrgsModule,
    AccountsModule,

    // M3c — cross-cutting cервисы: SecurityModule (SSRF/Encryption/IpHashing),
    // AuditModule, QuotasModule. Должны идти ДО Tasks/Highlights/Shares/Chat,
    // которые инжектят AuditLogService/QuotaService.
    SecurityModule,
    AuditModule,
    QuotasModule,
    ApiKeysModule,
    WebhooksOutModule,
    DestinationsModule,
    ExportsModule,
    ChatModule,
    PublicApiModule,

    // M3b workspace модули: tasks/chapters/highlights/shares/tags/templates.
    TasksModule,
    ChaptersModule,
    HighlightsModule,
    SharesModule,
    TagsModule,
    TemplatesModule,

    // CRM-структура встреч: карточки.
    CardsModule,

    // Глобальный поиск (⌘K).
    SearchModule,

    // In-meeting room chat (LiveKit DataChannel mirror → БД).
    RoomMessagesModule,
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
