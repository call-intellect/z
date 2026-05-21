import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';

import { ConfigModule } from './common/config/index';
import { CryptoModule } from './common/crypto/crypto.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { GraphModule } from './common/graph/graph.module';
import { MetricsModule } from './common/metrics/metrics.module';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { AdminModule } from './modules/admin/admin.module';
import { AiModule } from './modules/ai/ai.module';
import { WorkersModule } from './modules/ai/workers.module';
import { AuthModule } from './modules/auth/auth.module';
import { ChaptersModule } from './modules/chapters/chapters.module';
import { HealthModule } from './modules/health/health.module';
import { HighlightsModule } from './modules/highlights/highlights.module';
import { EntitlementsModule } from './modules/entitlements/entitlements.module';
import { EntitlementGuard } from './modules/entitlements/entitlement.guard';
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
import { DashboardModule } from './modules/dashboard/dashboard.module';
// Phase 0a — структура компании (группа А) + дополнительные эндпоинты.
import { DepartmentsModule } from './modules/departments/departments.module';
import { GoalsModule } from './modules/goals/goals.module';
import { JobDescriptionsModule } from './modules/job-descriptions/job-descriptions.module';
import { MeModule } from './modules/me/me.module';
import { PersonsModule } from './modules/persons/persons.module';
import { RoleProfilesModule } from './modules/role-profiles/role-profiles.module';
import { RolesDomainModule } from './modules/roles-domain/roles-domain.module';
import { SkillsModule } from './modules/skills/skills.module';
import { StructureModule } from './modules/structure/structure.module';
import { KnowledgeCoreApiModule } from './modules/knowledge-core/knowledge-core-api.module';
import { KnowledgeCoreModule } from './modules/knowledge-core/knowledge-core.module';
import { SearchModule } from './modules/search/search.module';
import { DestinationsModule } from './modules/destinations/destinations.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { ExportsModule } from './modules/exports/exports.module';
import { IngestEmailModule } from './modules/ingest/adapters/email/ingest-email.module';
import { IngestModule } from './modules/ingest/ingest.module';
import { OrgsModule } from './modules/orgs/orgs.module';
import { PublicApiModule } from './modules/public-api/public-api.module';
import { QuotasModule } from './modules/quotas/quotas.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { RoleProfilesAgentModule } from './modules/role-profiles/role-profiles-agent.module';
import { SecurityModule } from './modules/security/security.module';
import { SourcesModule } from './modules/sources/sources.module';
import { WebhooksOutModule } from './modules/webhooks-out/webhooks-out.module';

@Module({
  imports: [
    // Глобальный конфиг — должен идти ПЕРВЫМ, чтобы валидация ENV выполнилась
    // до любых других модулей, зависящих от значений.
    ConfigModule,

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

    // Глобальный GraphService (Фаза 0a) — единая точка работы с графом
    // Postgres EntityLink + Apache AGE (`z_graph`). Должен быть ДО любых
    // модулей, которые делают двойную запись узлов/рёбер (Persons, Roles,
    // Processes, RoleProfileAgent и т.п.). Зависит только от PrismaModule.
    GraphModule,

    // Глобальный CryptoService (Фаза 10 knowledge-core) — шифрование секретов
    // в Source.config (Telegram botToken, Mango apiKey/Salt, IMAP password).
    // Должен быть до SourcesModule / IngestModule / адаптеров.
    CryptoModule,

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

    // knowledge-core (Фаза 2) — Search API + Block/Entity controllers,
    // плюс глобальные сервисы block-ingest / distill / embedding и т.д.
    // Должен идти ПОСЛЕ AiModule: BlockMergeService / EntityMergeService
    // инжектят LlmRouterService из @Global() AiModule. Воркеры запускаются
    // в отдельном процессе (WorkersModule); здесь — только HTTP-side API.
    KnowledgeCoreModule,
    // HTTP-контроллеры knowledge-core (вынесены из @Global сервис-модуля).
    KnowledgeCoreApiModule,

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
    // Phase 12 knowledge-core — entitlements (тарифы / @RequireEntitlement / квоты).
    // Должен идти ПОСЛЕ AuditModule (audit инжектится сервисом) и ДО Quotas /
    // tenant-scoped модулей (chat, exports и т.п.), которые могут читать
    // EntitlementService.getQuota.
    EntitlementsModule,
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

    // Фаза 0b knowledge-core — Document-ingest pipeline. HTTP API
    // /api/v1/documents + multipart upload + текстовый дамп. Воркеры
    // (document.adapter, text.adapter) живут в WorkersModule.
    DocumentsModule,

    // Глобальный поиск (⌘K).
    SearchModule,

    // In-meeting room chat (LiveKit DataChannel mirror → БД).
    RoomMessagesModule,

    // Phase 8 — director dashboard (`GET /api/v1/dashboard/director`).
    // Зависит от Admin (AdminCacheService) / Rbac / Ai (LlmRouter) — все @Global.
    DashboardModule,

    // Phase 9 — цели компании + strategic-alignment (CRUD + темы).
    // Воркер живёт в WorkersModule (отдельный процесс).
    GoalsModule,

    // Phase 10 — Email IMAP адаптер + cron. Регистрируется отдельно от
    // IngestModule, потому что cron включается только если EMAIL_FETCH_ENABLED=true.
    IngestEmailModule,

    // Phase 10 — управление подключёнными источниками (telegram/mango/IMAP/web-form).
    // Зависит от @Global модулей: Crypto, Audit, Rbac, Ingest (TelegramAdapterService),
    // и от IngestEmailModule (для smoke-test IMAP).
    SourcesModule,

    // AI/knowledge-core воркеры и cron'ы — IN-PROCESS (отдельного worker-процесса
    // больше нет). Должен идти ПОСЛЕ всех @Global-модулей, чьи сервисы инжектят воркеры.
    WorkersModule,

    // Phase 0d — RoleProfileAgent (BullMQ-воркер + cron + on-demand rebuild).
    // Импортируется после WorkersModule, чтобы не дублировать BullMQ-инициализацию.
    // Зависит от CoreQueueModule, GraphModule (через traverse в будущем),
    // AiModule (LlmRouterService).
    RoleProfilesAgentModule,

    // Phase 0a (группа А) — CRUD структуры компании: отделы, должности,
    // сотрудники, должностные инструкции, компетенции + карта должности
    // (read + stub rebuild). Зависят от @Global Prisma / Rbac / Auth / Audit.
    DepartmentsModule,
    RolesDomainModule,
    PersonsModule,
    JobDescriptionsModule,
    SkillsModule,
    RoleProfilesModule,

    // Phase 0a.3 — структурные агрегаты + γ-счётчики
    // (/api/v1/structure/summary + /processes/count, /regulations/count, …).
    StructureModule,

    // Phase 0a.3 — GET /api/v1/me/profile (Person + Role + Department +
    // RoleProfile в контексте текущей Org).
    MeModule,
  ],
  providers: [
    // Фильтр зарегистрирован через DI.
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    // Phase 12: глобальный EntitlementGuard. Прозрачен для эндпоинтов
    // без `@RequireEntitlement(...)`. Внутренне читает `req.tenantId`,
    // выставленный `TenantGuard` — поэтому требует TenantGuard выше по
    // цепочке на gated-эндпоинтах.
    {
      provide: APP_GUARD,
      useClass: EntitlementGuard,
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
