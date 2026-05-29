import { Global, Module } from '@nestjs/common';

import { AdminAuditInterceptor } from './admin.audit.interceptor';
import { AdminAiModule } from './ai/ai.module';
import { AdminAiModelsController } from './ai-models/ai-models.controller';
import { AdminAiModelsService } from './ai-models/ai-models.service';
import { AiUsageAdminController } from './ai-usage.controller';
import { AnalyticsModule } from './analytics/analytics.module';
import { AdminAuditModule } from './audit/admin-audit.module';
import { ContentAdminModule } from './content/content-admin.module';
import { AdminDemoController } from './controllers/admin-demo.controller';
import { AdminExperimentsController } from './controllers/admin-experiments.controller';
import { AdminFunctionsController } from './controllers/admin-functions.controller';
import { AdminHealthController } from './controllers/admin-health.controller';
import { AdminOrgsController } from './controllers/admin-orgs.controller';
import { AdminPricesController } from './controllers/admin-prices.controller';
import { AdminUsageController } from './controllers/admin-usage.controller';
import { OrgAdminKnowledgeController } from './controllers/org-admin-knowledge.controller';
import { OrgAdminMemoryAccessController } from './controllers/org-admin-memory-access.controller';
import { OrgAdminUsageController } from './controllers/org-admin-usage.controller';
import { AdminCronsModule } from './crons/admin-crons.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { AdminEconomicsController } from './economics/admin-economics.controller';
import { AdminLlmModelsController } from './economics/admin-llm-models.controller';
import { AdminLlmModelsService } from './economics/admin-llm-models.service';
import { AdminLlmProvidersController } from './economics/admin-llm-providers.controller';
import { AdminLlmProvidersService } from './economics/admin-llm-providers.service';
import { BudgetAlertCron } from './economics/budget-alert.cron';
import { CurrencyRateSyncCron } from './economics/currency-rate-sync.cron';
import { CurrencyRateService } from './economics/currency-rate.service';
import { DailyCostAggregatorCron } from './economics/daily-cost-aggregator.cron';
import { OrgEconomicsController } from './economics/org-economics.controller';
import { OrgEconomicsCron } from './economics/org-economics.cron';
import { ProviderSmokeTestCron } from './economics/provider-smoke-test.cron';
import { UnitEconomicsService } from './economics/unit-economics.service';
import { AdminEntitlementsModule } from './entitlements/entitlements.module';
import { AdminIncidentsModule } from './incidents/admin-incidents.module';
import { IntegrationKeysAdminController } from './integration-keys.controller';
import { IntegrationsAdminModule } from './integrations/integrations-admin.module';
import { LlmPreferenceDatasetController } from './llm-preference-dataset/llm-preference-dataset.controller';
import { LlmRoutesController } from './llm-routes/llm-routes.controller';
import { LlmRoutesService } from './llm-routes/llm-routes.service';
import { AdminMediaModule } from './media/admin-media.module';
import { MeetingsAdminController } from './meetings-admin.controller';
import { AdminPlansModule } from './plans/plans.module';
import { PlatformAdminModule } from './platform/platform-admin.module';
import { AdminFeedbackController } from './prompt-templates/admin-feedback.controller';
import { AiResultFeedbackService } from './prompt-templates/ai-result-feedback.service';
import { MeetingResultFeedbackController } from './prompt-templates/meeting-result-feedback.controller';
import { AdminPromptExperimentsController } from './prompt-templates/prompt-experiments.controller';
import { PromptExperimentsService } from './prompt-templates/prompt-experiments.service';
import { PromptTemplatesPreviewService } from './prompt-templates/prompt-templates-preview.service';
import { AdminPromptTemplatesController } from './prompt-templates/prompt-templates.controller';
import { AdminPromptTemplatesService } from './prompt-templates/prompt-templates.service';
import { RecordingsAdminController } from './recordings-admin.controller';
import { AdminCacheService } from './services/admin-cache.service';
import { AdminExperimentsService } from './services/admin-experiments.service';
import { AdminFunctionsService } from './services/admin-functions.service';
import { AdminHealthService } from './services/admin-health.service';
import { AdminOrgsService } from './services/admin-orgs.service';
import { AdminPricesService } from './services/admin-prices.service';
import { AdminUsageService } from './services/admin-usage.service';
import { OrgAdminKnowledgeService } from './services/org-admin-knowledge.service';
import { AdminSettingsModule } from './settings/admin-settings.module';
import { SignalTypeMonitorController } from './signal-type-monitor/signal-type-monitor.controller';
import { SignalTypeMonitorService } from './signal-type-monitor/signal-type-monitor.service';
import { AdminSkillTraitConceptsModule } from './skill-trait-concepts/skill-trait-concepts.module';
import { SuperAdminAuditInterceptor } from './super-admin.audit.interceptor';
import { AdminTelegramBotController } from './system/telegram-bot/admin-telegram-bot.controller';
import { AdminTelegramBotService } from './system/telegram-bot/admin-telegram-bot.service';

/**
 * Admin-модуль (Phase 8.2).
 *
 * Все контроллеры — под `CookieAuthGuard + AdminGuard` и
 * `AdminAuditInterceptor` (адресно через `@UseInterceptors`, чтобы НЕ
 * аудитировать обычные user/guest эндпоинты).
 *
 * Зависит только от глобальных модулей: PrismaService, AuthModule,
 * LivekitModule, AiModule.
 */
@Global()
@Module({
  imports: [
    // Admin-redesign Фаза 0 — глобальные модули для динамических настроек
    // и менеджмента cron-джобов.
    AdminSettingsModule,
    AdminCronsModule,
    // Admin-redesign Фаза 1 — журнал super_admin и инциденты (BullMQ failed-jobs).
    AdminAuditModule,
    AdminIncidentsModule,
    // Admin-redesign Фаза 2 — read-only аналитика (knowledge + concierge).
    AnalyticsModule,
    // Admin-redesign Фаза 3 — AI smoke-test endpoints.
    AdminAiModule,
    // Admin-redesign Фаза 4 — Plans (CRUD планов продукта) и Entitlements
    // (глобальный обзор overrides + per-org мутации).
    AdminPlansModule,
    AdminEntitlementsModule,
    // Admin-redesign Фаза 5 — Контент продукта: типы встреч, шаблоны писем,
    // системные сообщения (баннеры), глобальные каналы, UI-строки.
    ContentAdminModule,
    // Admin-redesign Фаза 6 — Каналы и интеграции: Telegram/MAX-боты,
    // webhook subscriptions/deliveries management, LiveKit health.
    IntegrationsAdminModule,
    // Admin-redesign Фаза 7 — Записи и медиа: retention (RetentionPolicy)
    // и storage (S3 buckets stats + provider switch).
    AdminMediaModule,
    // Admin-redesign Фаза 8 — Платформа: BullMQ workers inspector, лимиты,
    // feature flags, security-настройки, maintenance статус.
    PlatformAdminModule,
    // ТЗ 2026-05-25 clone-reliability-hardening, Фаза 2 — Смысловые блоки навыка.
    AdminSkillTraitConceptsModule,
    // 2026-05-29 — демо-кабинет «ТехноСтрим» из админки (AdminDemoController).
    OnboardingModule,
  ],
  controllers: [
    AdminDemoController,
    IntegrationKeysAdminController,
    MeetingsAdminController,
    AiUsageAdminController,
    RecordingsAdminController,
    LlmRoutesController,
    AdminAiModelsController,
    AdminPromptTemplatesController,
    AdminPromptExperimentsController,
    AdminFeedbackController,
    MeetingResultFeedbackController,
    AdminUsageController,
    OrgAdminUsageController,
    AdminFunctionsController,
    AdminExperimentsController,
    AdminPricesController,
    AdminOrgsController,
    AdminHealthController,
    OrgAdminKnowledgeController,
    // ТЗ 2026-05-26 §6 — управление доступом member к «Памяти компании».
    OrgAdminMemoryAccessController,
    // SBA α-10 wave 3 — Admin LLM + Unit Economics.
    AdminLlmProvidersController,
    AdminLlmModelsController,
    AdminEconomicsController,
    OrgEconomicsController,
    // β-9 Phase 4 — главная админка Z, глобальный Telegram-бот.
    AdminTelegramBotController,
    // W2.3 KC-Temporal (2026-05-25) — admin download preference-dataset.
    LlmPreferenceDatasetController,
    // G.2 KC-Temporal (2026-05-25) — admin view матрицы переходов signalType.
    SignalTypeMonitorController,
  ],
  providers: [
    AdminAuditInterceptor,
    SuperAdminAuditInterceptor,
    LlmRoutesService,
    AdminAiModelsService,
    AdminPromptTemplatesService,
    PromptTemplatesPreviewService,
    PromptExperimentsService,
    AiResultFeedbackService,
    AdminCacheService,
    AdminUsageService,
    AdminFunctionsService,
    AdminExperimentsService,
    AdminPricesService,
    AdminOrgsService,
    AdminHealthService,
    OrgAdminKnowledgeService,
    // SBA α-10 wave 3 — services + cron'ы.
    AdminLlmProvidersService,
    AdminLlmModelsService,
    UnitEconomicsService,
    CurrencyRateService,
    DailyCostAggregatorCron,
    OrgEconomicsCron,
    BudgetAlertCron,
    CurrencyRateSyncCron,
    ProviderSmokeTestCron,
    // β-9 Phase 4 — service для админки Telegram-бота. TelegramApiClient
    // импортируется из ConversationalModule (global).
    AdminTelegramBotService,
    // G.2 KC-Temporal (2026-05-25) — чтение AdminSetting{key=signal_type_transition_matrix:*}.
    SignalTypeMonitorService,
  ],
  exports: [
    AdminAuditInterceptor,
    SuperAdminAuditInterceptor,
    AdminCacheService,
    AdminUsageService,
    AdminFunctionsService,
    AdminExperimentsService,
    AdminPricesService,
    AdminOrgsService,
    AdminHealthService,
    OrgAdminKnowledgeService,
    PromptExperimentsService,
    AiResultFeedbackService,
    // SBA α-10 wave 3.
    AdminLlmProvidersService,
    AdminLlmModelsService,
    UnitEconomicsService,
    CurrencyRateService,
    DailyCostAggregatorCron,
    OrgEconomicsCron,
    BudgetAlertCron,
    CurrencyRateSyncCron,
    ProviderSmokeTestCron,
  ],
})
export class AdminModule {}
