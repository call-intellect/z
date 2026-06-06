import { Module, RequestMethod, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';

import { ConfigModule } from './common/config/index';
import { CryptoModule } from './common/crypto/crypto.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { GraphModule } from './common/graph/graph.module';
import { DemoObserverGuard } from './common/guards/demo-observer.guard';
import { IdempotencyMiddleware } from './common/idempotency/idempotency.middleware';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { MetricsModule } from './common/metrics/metrics.module';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { ActivityFeedModule } from './modules/activity-feed/activity-feed.module';
import { AdminModule } from './modules/admin/admin.module';
import { AiModule } from './modules/ai/ai.module';
import { WorkersModule } from './modules/ai/workers.module';
import { AiChatQuotaModule } from './modules/ai-chat-quota/ai-chat-quota.module';
// M3c — cross-cutting ai-workspace модули.
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { MustChangePasswordGuard } from './modules/auth/guards/must-change-password.guard';
import { BehaviorMetricsModule } from './modules/behavior-metrics/behavior-metrics.module';
import { BillingModule } from './modules/billing/billing.module';
import { SubscriptionGuard } from './modules/billing/guards/subscription.guard';
import { BrandVoiceModule } from './modules/brand-voice/brand-voice.module';
import { CardsModule } from './modules/cards/cards.module';
import { ChaptersModule } from './modules/chapters/chapters.module';
import { ChatModule } from './modules/chat/chat.module';
import { ChatV2Module } from './modules/chat-v2/chat-v2.module';
import { ChatboxModule } from './modules/chatbox/chatbox.module';
// Phase 0a — структура компании (группа А) + дополнительные эндпоинты.
import { ClonesModule } from './modules/clones/clones.module';
import { CompanyFoundationModule } from './modules/company-foundation/company-foundation.module';
import { ConciergeModule } from './modules/concierge/concierge.module';
import { ConversationalModule } from './modules/conversational/conversational.module';
import { CoreQueueModule } from './modules/core-queue/core-queue.module';
import { CurationModule } from './modules/curation/curation.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
// SBA α-3 — категория A онтологии: поставщики и события.
// Calendar MVP Фаза P4 (2026-05-25) — объединённый поиск участников событий.
import { DecisionsModule } from './modules/decisions/decisions.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { DestinationsModule } from './modules/destinations/destinations.module';
import { DialogLayerModule } from './modules/dialog-layer/dialog-layer.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { EntitlementGuard } from './modules/entitlements/entitlement.guard';
import { EntitlementsModule } from './modules/entitlements/entitlements.module';
import { EventsModule } from './modules/events/events.module';
import { ExperimentsModule } from './modules/experiments/experiments.module';
import { ExportsModule } from './modules/exports/exports.module';
import { FeedbackModule } from './modules/feedback/feedback.module';
import { GoalsModule } from './modules/goals/goals.module';
import { HealthModule } from './modules/health/health.module';
import { HighlightsModule } from './modules/highlights/highlights.module';
import { IdeasModule } from './modules/ideas/ideas.module';
import { IngestEmailModule } from './modules/ingest/adapters/email/ingest-email.module';
import { IngestModule } from './modules/ingest/ingest.module';
import { InnLookupModule } from './modules/inn-lookup/inn-lookup.module';
import { InsightsModule } from './modules/insights/insights.module';
import { CrossmarkModule } from './modules/integrations-crossmark/crossmark.module';
import { JobDescriptionsModule } from './modules/job-descriptions/job-descriptions.module';
import { KnowledgeAccessModule } from './modules/knowledge-access/knowledge-access.module';
import { KnowledgeCloneModule } from './modules/knowledge-clone/knowledge-clone.module';
import { KnowledgeCoreApiModule } from './modules/knowledge-core/knowledge-core-api.module';
import { KnowledgeCoreModule } from './modules/knowledge-core/knowledge-core.module';
import { Specialist31Module } from './modules/knowledge-core/specialist-3-1.module';
import { Specialist32Module } from './modules/knowledge-core/specialist-3-2.module';
import { Specialist33Module } from './modules/knowledge-core/specialist-3-3.module';
import { Specialist34Module } from './modules/knowledge-core/specialist-3-4.module';
import { Specialist35Module } from './modules/knowledge-core/specialist-3-5.module';
import { Specialist36Module } from './modules/knowledge-core/specialist-3-6.module';
import { KpiModule } from './modules/kpi/kpi.module';
import { LivekitModule } from './modules/livekit/livekit.module';
import { LoggingModule } from './modules/logging/logging.module';
import { RequestContextMiddleware } from './modules/logging/request-context.middleware';
import { MailInboundModule } from './modules/mail/inbound/mail-inbound.module';
import { MailModule } from './modules/mail/mail.module';
import { MeModule } from './modules/me/me.module';
import { MeetingReportsModule } from './modules/meeting-reports/meeting-reports.module';
import { MeetingsModule } from './modules/meetings/meetings.module';
import { MeetingsBalanceModule } from './modules/meetings-balance/meetings-balance.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { OperationsModule } from './modules/operations/operations.module';
import { OrchestratorModule } from './modules/orchestrator/orchestrator.module';
import { OrgMembersModule } from './modules/org-members/org-members.module';
import { OrgsModule } from './modules/orgs/orgs.module';
import { ParticipantsModule } from './modules/participants/participants.module';
import { PendingActionsModule } from './modules/pending-actions/pending-actions.module';
import { PersonsModule } from './modules/persons/persons.module';
import { PracticeSkillsModule } from './modules/practice-skills/practice-skills.module';
import { ProactiveModule } from './modules/proactive/proactive.module';
import { ProbeModule } from './modules/probe/probe.module';
import { ProcessesModule } from './modules/processes/processes.module';
import { PromptEvolutionModule } from './modules/prompt-evolution/prompt-evolution.module';
import { PublicApiModule } from './modules/public-api/public-api.module';
// Wave 2 (2026-05-24) — Activity Feeds + Specialist 3.8 Helpfulness + Recognition + Web Push.
import { PushModule } from './modules/push/push.module';
import { QualityScoreModule } from './modules/quality-score/quality-score.module';
import { QuotasModule } from './modules/quotas/quotas.module';
import { TenantMiddleware } from './modules/rbac/middleware/tenant.middleware';
import { RbacModule } from './modules/rbac/rbac.module';
import { RecognitionModule } from './modules/recognition/recognition.module';
import { RecordingsModule } from './modules/recordings/recordings.module';
import { ReferralsModule } from './modules/referrals/referrals.module';
import { RegulationsModule } from './modules/regulations/regulations.module';
import { RetentionModule } from './modules/retention/retention.module';
import { RoleMapModule } from './modules/role-map/role-map.module';
import { RoleProfilesAgentModule } from './modules/role-profiles/role-profiles-agent.module';
import { RoleProfilesModule } from './modules/role-profiles/role-profiles.module';
import { RolesDomainModule } from './modules/roles-domain/roles-domain.module';
import { RoomMessagesModule } from './modules/room-messages/room-messages.module';
import { SearchModule } from './modules/search/search.module';
import { SecurityModule } from './modules/security/security.module';
import { SharesModule } from './modules/shares/shares.module';
import { SkillsModule } from './modules/skills/skills.module';
import { SourcesModule } from './modules/sources/sources.module';
import { Specialist38HelpfulnessModule } from './modules/specialist-3-8-helpfulness/specialist-3-8-helpfulness.module';
import { StructureModule } from './modules/structure/structure.module';
import { TablesModule } from './modules/tables/tables.module';
import { TagsModule } from './modules/tags/tags.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { TrackerModule } from './modules/tracker/tracker.module';
import { UsersModule } from './modules/users/users.module';
import { VendorsModule } from './modules/vendors/vendors.module';
import { VoiceModule } from './modules/voice/voice.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
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

    // SBA β-5 — глобальный EventEmitter (для idea.status_changed, idea.created,
    // notification.responded). Wildcard включён, чтобы Probe-Agent мог слушать
    // 'notification.*'.
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
      maxListeners: 32,
      verboseMemoryLeak: false,
    }),

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

    // Общий Idempotency-Key store (Redis) для tracker-эндпоинтов. Подключается
    // через middleware ниже (см. configure). Должен идти ПОСЛЕ RedisModule
    // (инжектит RedisService).
    IdempotencyModule,

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
    // Admin REST доступа к знаниям через группы (ТЗ 2026-06-06, Фаза 7A).
    KnowledgeAccessModule,

    // Бизнес-модули.
    HealthModule,
    // ТЗ 2026-05-27 (billing) Фаза 3: MeetingsBalance ДО MeetingsModule —
    // MeetingsService инжектит MeetingsBalanceService при создании встречи.
    MeetingsBalanceModule,
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
    OnboardingModule,

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
    // ТЗ 2026-05-31 ai-chat-quota — единая per-user квота Concierge+Clones.
    // @Global, использует QuotaService (Redis INCR) + RbacService (resolve роли).
    // Должен идти ПОСЛЕ QuotasModule и RbacModule (оба @Global, но порядок
    // важен для предсказуемости bootstrap).
    AiChatQuotaModule,
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

    // Tracker (Sprint 1, Phase 1) — PLG-точка входа платформы. Project /
    // Issue / Cycle / Intake / Comment / Label / Webhook + IssueActivity.
    // RBAC ResourceType: project / issue / cycle / intake_issue /
    // team_template / issue_webhook. Регистрируется ПОСЛЕ TasksModule
    // (legacy) — миграция Task → Issue в Sprint 3.
    TrackerModule,

    // Tracker Phase 4 (T5, 2026-05-24) — email-to-task через общий IMAP-ящик
    // inbox.kora.app + routing по per-project alias. Cron каждые 2 мин
    // (управляется MAIL_INBOX_ENABLED + MAIL_INBOX_POLL_CRON).
    MailInboundModule,

    // CRM-структура встреч: карточки.
    CardsModule,

    // Фаза B — поведенческие метрики (HTTP endpoints; воркер живёт в WorkersModule).
    BehaviorMetricsModule,

    // Фаза C — AI-оценка качества встречи (HTTP endpoints; воркер — в WorkersModule).
    QualityScoreModule,

    // Фаза E — несколько AI-отчётов на одну встречу (HTTP endpoints;
    // воркер ai.custom-report — в WorkersModule).
    MeetingReportsModule,

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

    // ChatBox-интеграция (ТЗ 2026-06-05) — конфиг + API-клиент + выбор воркспейса.
    // Зависит от @Global: Crypto, Rbac, Entitlements, Config.
    ChatboxModule,

    // AI/knowledge-core воркеры и cron'ы — IN-PROCESS (отдельного worker-процесса
    // больше нет). Должен идти ПОСЛЕ всех @Global-модулей, чьи сервисы инжектят воркеры.
    WorkersModule,

    // Phase 0d — RoleProfileAgent (BullMQ-воркер + cron + on-demand rebuild).
    // Импортируется после WorkersModule, чтобы не дублировать BullMQ-инициализацию.
    // Зависит от CoreQueueModule, GraphModule (через traverse в будущем),
    // AiModule (LlmRouterService).
    RoleProfilesAgentModule,

    // SBA α-8 wave 4 — Role Map module (5 CRUD-сервисов wave-2 + builder
    // worker + completeness cron + REST `/api/v1/roles/:id/{map,maturity,
    // responsibilities,authority,knowledge,decision-policies,interactions}`).
    // Зависит от @Global Prisma / Rbac / Auth / Audit / Metrics / Redis / Ai
    // (LlmRouterService) / ScheduleModule. Регистрируется после WorkersModule
    // и AppointmentsModule (Role + RoleProfile + Metric — связи в schema готовы).
    RoleMapModule,

    // Phase 0a (группа А) — CRUD структуры компании: отделы, должности,
    // сотрудники, должностные инструкции, компетенции + карта должности
    // (read + stub rebuild). Зависят от @Global Prisma / Rbac / Auth / Audit.
    DepartmentsModule,
    RolesDomainModule,
    PersonsModule,
    // SBA α-8 wave 3 — Appointment (replacement для PersonRole) + KPI (Metric ext).
    AppointmentsModule,
    KpiModule,
    JobDescriptionsModule,
    SkillsModule,
    RoleProfilesModule,

    // Phase 0a.3 — структурные агрегаты + γ-счётчики
    // (/api/v1/structure/summary + /processes/count, /regulations/count, …).
    StructureModule,

    // SBA α-9 wave 3 — Company Foundation. CompanyProfile / FunctionalDomain /
    // DepartmentDomainLink / MaturityScorer + 4 cron'а.
    CompanyFoundationModule,

    // Phase 0a.3 — GET /api/v1/me/profile (Person + Role + Department +
    // RoleProfile в контексте текущей Org).
    MeModule,

    // SBA α-1 — Conversational Channels Foundation.
    // @Global модуль (Channel/Notification/Delivery), используется Layer 4
    // (curation), Layer 5 (chat-v2 inbound), Layer 6 (probe-agent). Регистрируется
    // ПОСЛЕ MailModule и IngestModule, потому что адаптеры инжектят MailService
    // и ConversationalIngestAdapter — IngestService.
    ConversationalModule,

    // SBA α-3 — Layer 2 ontology extension. Read-only API для Vendor / Event
    // (категория A онтологии). POST/PATCH/DELETE — в α-6.
    VendorsModule,
    EventsModule,
    // Calendar MVP Фаза P4 — объединённый поиск участников (/api/v1/org-members/search).
    OrgMembersModule,

    // SBA α-4 — Layer 4 Curation Foundation. CurationService.triage(...) +
    // ConflictService.report(...) для специалистов Слоя 3, REST API для
    // куратора, stale-detection cron. Должен быть ПОСЛЕ ConversationalModule
    // (использует sendNotification).
    CurationModule,

    // Action Center B0 (2026-06-02) — единый агрегатор «требует действия»
    // (PendingActionsService) + REST для бейджа/списка/snooze. Фундамент
    // Части B (бейдж, колокольчик, дашборд CEO, Telegram). Провайдеры читают
    // read-models напрямую — порядок относительно CurationModule не важен.
    PendingActionsModule,

    // SBA α-5 dialog-layer — препроцессор chat-v2 (Contextualizer / Confidence /
    // Classifier / MultiQuery / Summarizer + AnswerCache/RetrievalCache).
    // @Global — DialogService инъектируется в SynthesisService и
    // ChatV2OrchestrationService. Зависит от @Global AiModule (LlmRouterService),
    // RedisModule, PrismaModule, EventEmitterModule. Должен идти ДО ChatV2Module.
    // См. plans/tz/2026-05-23-sba-alpha-5-dialog-layer-and-cache.md.
    DialogLayerModule,

    // SBA α-5 — Layer 5 Chat-v2 Omnichannel. Новый модуль chat-v2/ с
    // conversation history (ChatV2Conversation + ChatV2Message) и
    // omnichannel inbound через ConversationalService.subscribeInbound
    // ('chat_query'). Зависит от @Global KnowledgeCoreModule (ChatV2Service)
    // и ConversationalModule (subscribeInbound + sendChatReply). Должен
    // быть ПОСЛЕ обоих. Legacy `ChatModule` остаётся живым (помечен
    // @deprecated, переключается через ENV CHAT_V2_ENABLED).
    ChatV2Module,

    // SBA α-6 — регистрация специалиста 3.4 (Project / Customer Context)
    // в CardSpecialistRegistry chat-v2. Должен идти ПОСЛЕ ChatV2Module
    // (использует CardSpecialistRegistry из него).
    Specialist34Module,

    // SBA α-7 — регистрация специалиста 3.1 (Regulations / Processes /
    // Policies) в CardSpecialistRegistry chat-v2. Должен идти ПОСЛЕ
    // ChatV2Module и параллельно Specialist34Module — оба регистрируются
    // в одном реестре с разными именами.
    Specialist31Module,

    // SBA α-7 — REST API `/api/v1/regulations` (master-detail для
    // Regulation / Process / Policy с фильтром kind). RBAC через
    // существующие `regulation` / `process` / `policy` ResourceType.
    RegulationsModule,

    // SBA α-7 wave 2 — REST API `/api/v1/processes/*` (ProcessTemplate +
    // ProcessTemplateVersion + DecisionPoint + ProcessHandoff). RBAC через
    // `process_template` ResourceType. Должен идти ПОСЛЕ KnowledgeCoreModule
    // (использует LlmRouterService через @Global Ai) и ConversationalModule
    // (probe-service fallback).
    ProcessesModule,

    // SBA β-2 — регистрация специалиста 3.2 (Knowledge Clone) в
    // CardSpecialistRegistry chat-v2. Должен идти ПОСЛЕ ChatV2Module
    // (использует CardSpecialistRegistry).
    Specialist32Module,

    // SBA β-3 — регистрация специалиста 3.3 (Decisions Registry) в
    // CardSpecialistRegistry chat-v2. Должен идти ПОСЛЕ ChatV2Module.
    Specialist33Module,

    // SBA β-3 — REST API `/api/v1/decisions` (master-detail для решений).
    // RBAC через `decision` ResourceType (см. policy.csv).
    DecisionsModule,

    // SBA β-4 — регистрация специалиста 3.5 (Insights Radar) в
    // CardSpecialistRegistry chat-v2. Должен идти ПОСЛЕ ChatV2Module.
    Specialist35Module,

    // SBA β-4 — REST API `/api/v1/insights` (master-detail радара сигналов).
    // RBAC через `insight` ResourceType (см. policy.csv).
    InsightsModule,

    // ТЗ 2026-05-27 — InnLookup (Mock + DaData; Tochka добавляется в Фазе 7).
    // Используется при регистрации Org (автоподстановка реквизитов) и при
    // верификации ИНН реферала. Redis-кэш TTL 30 дней.
    InnLookupModule,

    // ТЗ 2026-05-27 — биллинг (Subscription/Invoice/Provider).
    // Фаза 4a: pure-сервисы (SeatService, InvoiceNumberService) +
    // BillingProviderPort с ManualBillingProvider-заглушкой.
    // Controllers/cron подъезжают в Фазе 4b, TochkaBillingProvider — в Фазе 5.
    BillingModule,

    // ТЗ 2026-05-27 — реферальная программа (Фаза 6).
    // ReferralPayoutService подписан на billing.invoice.paid через @OnEvent —
    // регистрируется ПОСЛЕ BillingModule.
    ReferralsModule,

    // Wave 2 (2026-05-24) — Activity Feeds: единая лента активности AI-агентов
    // и пользователей. @Global ActivityFeedService.publish() вызывают
    // ProbeAgent, InsightsRadar, DecisionsRegistry, Specialist3.8 Helpfulness,
    // RecognitionAgent. Должен идти ДО ProbeModule и Specialist38Helpfulness
    // (они инжектят ActivityFeedService).
    ActivityFeedModule,

    // SBA β-6 — REST API `/api/v1/experiments` (master-detail Experiment Tracker'а:
    // институциональная память «что попробовали и что вышло»). RBAC через
    // `experiment` ResourceType (см. policy.csv).
    ExperimentsModule,

    // SBA β-5 — Layer 6 Probe-Agent (@Global). ProbeService.suggest вызывают
    // все Specialist3X-probe сервисы (через @Optional inject — fallback на
    // прямой sendNotification). ProbeDispatcherWorker + ProbePriorityCron
    // поднимаются IN-PROCESS. Должен идти ПОСЛЕ ConversationalModule,
    // AiModule, CoreQueueModule, KnowledgeCoreModule.
    ProbeModule,

    // SBA β-5 — регистрация специалиста 3.6 (Ideas Collector) в
    // CardSpecialistRegistry + IdeasClosingLoopHandler (@OnEvent
    // 'idea.status_changed'). Должен идти ПОСЛЕ ChatV2Module и
    // ConversationalModule.
    Specialist36Module,

    // SBA β-5 — REST API `/api/v1/ideas` + `/api/v1/idea-clusters` +
    // `/api/v1/me/ideas`. RBAC через `idea` ResourceType.
    IdeasModule,

    // Wave 2 (2026-05-24) — Specialist 3.8 Helpfulness Agent. Worker подписан на
    // core.specialist-routing jobName=3-8-helpfulness, 4 cron (profile/spotlight/
    // decay/probe). Этическая защита: question_unanswered/question_acknowledged
    // _no_action только private (admin + руководитель). Должен идти ПОСЛЕ
    // KnowledgeCoreModule (RouterService), AiModule (LlmRouterService), ProbeModule.
    Specialist38HelpfulnessModule,

    // Wave 2 (2026-05-24) — Recognition + Gamification. Worker
    // core.recognition-formulate, 4 cron (snapshot/badge-awarder/streak/digest).
    // Recognition от AI (fromUserId=null), не от руководителя автоматически.
    // Bridge POST /api/v1/issues/comments/:id/thanks → enqueue thanks_comment.
    // Должен идти ПОСЛЕ AiModule, CoreQueueModule, ActivityFeedModule.
    RecognitionModule,

    // Wave 2 finishing (2026-05-24) — backend web-push (VAPID).
    // POST/DELETE/GET /api/v1/me/push-subscriptions + consumer core.push-send +
    // PushCleanupCron (03:00 UTC). @Global — для интеграции с
    // ActivityFeedService/RecognitionService через CoreQueueService.enqueuePushSend.
    // Без VAPID ENV (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY) физическая отправка
    // отключена с warn, persistence подписок работает.
    PushModule,

    // SBA β-2 — REST API `/api/v1/me/knowledge-profile` и
    // `/api/v1/persons/:id/knowledge-profile` + mark-wrong (CurationItem
    // deep review). RBAC ResourceType — `knowledge_profile`.
    KnowledgeCloneModule,

    // SBA γ-1 — REST API `/api/v1/clones/persons/:id/ask` +
    // `/api/v1/clones/roles/:id/ask`. RBAC: ClonesService.canAccessPersonClone
    // (owner/admin/self/direct manager). Rate limit через Redis.
    // Должен идти ПОСЛЕ KnowledgeCoreModule (ExecutablePersonaBuildService)
    // и ChatV2Module (через SynthesisService подтягивает ClonesService).
    ClonesModule,

    // SBA β-7 — Brand Voice Curator (Specialist 3.10). Exports
    // BrandVoiceService — chat-v2 SynthesisService опционально подмешивает
    // профиль в systemPrompt при mode='clone_style' scope='org'. Должен
    // идти ПОСЛЕ ChatV2Module, чтобы SynthesisService мог инжектить
    // BrandVoiceService через @Optional.
    BrandVoiceModule,

    // SBA γ-2 — Concierge Agent. REST API `/api/v1/concierge/*` (SSE stream
    // + polling fallback + conversations + undo + quota). Tool-use loop через
    // whitelist REST tools (ServiceMapGeneratorService). 3 cron'а:
    // daily/monthly quota reset, conversation summarizer. Должен идти ПОСЛЕ
    // ChatV2Module / KnowledgeCoreModule / всех Spec*Module, чтобы ToolRouter
    // мог дёргать их REST tools через internal loopback.
    ConciergeModule,

    // SBA δ-3 — VoiceChannelAdapter. REST API `/api/v1/voice/transcribe|synthesize`
    // (ASR через Vox + TTS через OpenAI). Reusable `VoiceChannelAdapter` для
    // Telegram/MAX-адаптеров и будущего concierge voice WS-handler'а (γ-2).
    // Зависит от @Global AiModule (VoxService) и @Global MetricsModule.
    VoiceModule,

    // SBA β-8 — PersonalRelation + COO Operations Dashboard + DailyCheckIn.
    // Содержит REST `/api/v1/dashboard/operations/*`, `/api/v1/me/check-ins`,
    // `/api/v1/personal-relations` + DailyCheckInPromptCron + CheckinResponseHandler
    // + GoalCascadeService. Должен идти ПОСЛЕ ConversationalModule (cron
    // зовёт sendNotification) и AiModule (CheckinParserService инжектит
    // LlmRouterService).
    OperationsModule,

    // SBA δ-1 — Orchestrator (multi-agent deep research). REST API
    // `/api/v1/orchestrator/*` (SSE stream + JSON polling + cancel).
    // 4 шага: plan → spawn subagents → synthesize → verify. BullMQ-очередь
    // `orchestrator.subagents` живёт ВНУТРИ модуля. Hard limits: depth=1,
    // max 5 subagents, 15-min timeout, feature-flag ORCHESTRATOR_ENABLED
    // default false. Должен идти ПОСЛЕ KnowledgeCoreModule (использует
    // ChatV2RetrievalService через subagent-стратегии).
    OrchestratorModule,

    // SBA δ-2 — ProactiveWatcher: каждые 6 часов обходит 8 deterministic-
    // правил над графом (Decision/Insight/Experiment/Process/Role/...) и
    // отправляет инициативные friendly-уведомления через ConversationalService.
    // REST `/api/v1/me/proactive-notifications` (list + dismiss). Anti-spam —
    // max 1 per user per day через Redis SETNX. Должен идти ПОСЛЕ
    // ConversationalModule (sendNotification) и AiModule (LlmRouter).
    ProactiveModule,

    // User Feedback with AI Clustering (2026-05-25) — канал «Ваши предложения»
    // для аутентифицированных пользователей. POST/GET /api/v1/feedback +
    // SUPER-ADMIN CRUD /api/v1/admin/feedback. Ночной digest 01:00 UTC
    // регистрируется в WorkersModule (Фаза 5). Зависит от @Global Prisma /
    // Redis и AuthModule (Cookie/SuperAdmin guards). См.
    // plans/tz/2026-05-25-user-feedback-with-ai-clustering.md.
    FeedbackModule,

    // Agents v2 Фаза B1 (2026-05-30) — Prompt Evolution (AutoRule, shadow).
    // Слушает `ai.invocation.completed` LlmRouter'а и накапливает feedback,
    // ночной cron 03:00 строит черновые правила (PromptRule status='shadow').
    // В Фазе B инъекции в реальные prompts НЕТ — только сбор данных для C.
    // Зависит от @Global AiModule, EmbeddingsModule, RedisModule, MetricsModule.
    // См. plans/tz/2026-05-29-agents-v2-umbrella.md §B1.
    PromptEvolutionModule,

    // Agents v2 Фаза C1 (2026-05-30) — PracticeSkills (выполняемые навыки клонов).
    // Extractor — слушает `skill-trait-concept.normalized`, извлекает процедуры
    // из reasoning-блоков сотрудников. Retrieval — KNN top-K skill'ов для
    // clone-respond (за флагом PRACTICE_SKILLS_ENABLED). Evaluator — daily 04:00
    // cron: composite score vs baseline → promote/archive shadow skill'ов.
    // Зависит от @Global AiModule, KnowledgeCoreModule (KnowledgeEmbeddingService),
    // RedisModule, MetricsModule, EventEmitterModule.
    // См. plans/tz/2026-05-29-agents-v2-umbrella.md §C1.
    PracticeSkillsModule,

    // Smart Tables Фаза 0 (2026-05-31) — каркас CRUD Notion/Teamly-style
    // базы данных. REST: /api/v1/tables, /api/v1/tables/:id/properties,
    // /api/v1/tables/:id/rows. RBAC: ресурс `table`. Views / Automations /
    // AI / Public forms — отдельные фазы 1+. Зависит от @Global Prisma,
    // RbacModule (TenantGuard + canRead/canWrite), AuthModule (CookieAuthGuard),
    // ConfigModule (TypedConfigService для TABLE_MAX_* лимитов).
    // См. plans/tz/2026-05-31-smart-tables.md.
    TablesModule,

    // LoggingModule (2026-06-01) — централизованное техническое логирование в БД.
    // @Global: LogService доступен всему приложению; регистрирует глобальный
    // RequestLoggingInterceptor. См. plans/tz/2026-06-01-logging-module.md.
    LoggingModule,
  ],
  providers: [
    // Фильтр зарегистрирован через DI.
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    // Глобальный SubscriptionGuard (paywall без trial). Прозрачен для
    // эндпоинтов без `@RequireSubscription()`. Проверяет status === 'ACTIVE'.
    // Внутренне читает `req.tenantId`, выставленный `TenantGuard` — поэтому
    // требует TenantGuard выше по цепочке на gated-эндпоинтах.
    // Цепочка: CookieAuthGuard → TenantGuard → SubscriptionGuard → EntitlementGuard → RbacGuard.
    {
      provide: APP_GUARD,
      useClass: SubscriptionGuard,
    },
    // Phase 12: глобальный EntitlementGuard. Прозрачен для эндпоинтов
    // без `@RequireEntitlement(...)`. Внутренне читает `req.tenantId`,
    // выставленный `TenantGuard` — поэтому требует TenantGuard выше по
    // цепочке на gated-эндпоинтах.
    {
      provide: APP_GUARD,
      useClass: EntitlementGuard,
    },
    // audit Б2 (2026-05-29) — глобальный MustChangePasswordGuard. Прозрачен
    // для публичных роутов (req.user == null) и для пользователей с
    // mustChangePassword=false. Иначе блокирует всё кроме whitelist'а
    // (/me, /me/change-password, /me/set-initial-password, /me/onboarding/*,
    // /auth/logout, /entitlements/me).
    // НЕ требует TenantGuard выше — работает на req.user.id.
    {
      provide: APP_GUARD,
      useClass: MustChangePasswordGuard,
    },
    // 2026-06-01 (ТЗ shared-demo-org-model §4.3) — глобальный DemoObserverGuard.
    // Режет mutating-эндпоинты для роли `demo_observer` в эталонной демо-Org.
    // Сам грузит membership через RbacService.loadContext (req.tenantId уже от
    // TenantMiddleware). super_admin bypass + @PublicDemo() для исключений.
    {
      provide: APP_GUARD,
      useClass: DemoObserverGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');

    // RequestContextMiddleware — оборачивает запрос в AsyncLocalStorage-контекст
    // ПОСЛЕ RequestIdMiddleware (нужен req.id) и ПЕРЕД TenantMiddleware/guards,
    // чтобы LogService мог читать requestId/userId/orgId на горячем пути.
    consumer.apply(RequestContextMiddleware).forRoutes('*');

    // TenantMiddleware — выставляет `req.tenantId` ДО глобальных guards
    // (SubscriptionGuard / EntitlementGuard), чтобы они могли работать на
    // эндпоинтах с @RequireEntitlement / @RequireSubscription декораторами.
    // Без него `req.tenantId` появлялся только после controller-level
    // TenantGuard, который бежит ПОСЛЕ глобальных guards → 403 tenant_required
    // на /api/v1/dashboard/director и других gated-эндпоинтах.
    // Single-org fallback остаётся в TenantGuard (нужен req.user.id).
    consumer.apply(TenantMiddleware).forRoutes('api/v1/*');

    // NB: сохранение `req.rawBody` для всех запросов — глобально через
    // `express.json({ verify })` в `main.ts`. Это нужно для проверки HMAC-
    // подписей Crossmark-интеграции и LiveKit-вебхуков. Парсинг `req.body`
    // продолжает работать как раньше.

    // Idempotency-Key для tracker-эндпоинтов. Покрывает три «создающих» POST'а,
    // где двойная отправка с одинаковым ключом должна вернуть тот же ответ
    // вместо нового ресурса. Полные пути контроллеров — `api/v1/issues`,
    // `api/v1/issues/:id/comments`, `api/v1/intake` (см. @Controller('api/v1')
    // в tracker/controllers/*).
    consumer
      .apply(IdempotencyMiddleware)
      .forRoutes(
        { path: 'api/v1/projects/:projectId/issues', method: RequestMethod.POST },
        { path: 'api/v1/issues/:id/comments', method: RequestMethod.POST },
        { path: 'api/v1/intake', method: RequestMethod.POST },
        // Sprints (2026-05-28, ТЗ §1.3) — quick-create спринта может ретраиться
        // фронтом при медленной сети; гарантируем, что один и тот же
        // Idempotency-Key возвращает первый созданный {projectId,cycleId},
        // а не плодит дубли проектов.
        { path: 'api/v1/sprints/quick-create', method: RequestMethod.POST },
      );
  }
}
