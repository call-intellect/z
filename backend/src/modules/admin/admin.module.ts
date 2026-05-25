import { Global, Module } from '@nestjs/common';

import { AdminAuditInterceptor } from './admin.audit.interceptor';
import { AdminAiModelsController } from './ai-models/ai-models.controller';
import { AdminAiModelsService } from './ai-models/ai-models.service';
import { AdminAuditModule } from './audit/admin-audit.module';
import { AdminCronsModule } from './crons/admin-crons.module';
import { AdminIncidentsModule } from './incidents/admin-incidents.module';
import { AdminEconomicsController } from './economics/admin-economics.controller';
import { AdminLlmModelsController } from './economics/admin-llm-models.controller';
import { AdminLlmModelsService } from './economics/admin-llm-models.service';
import { AdminLlmProvidersController } from './economics/admin-llm-providers.controller';
import { AdminLlmProvidersService } from './economics/admin-llm-providers.service';
import { BudgetAlertCron } from './economics/budget-alert.cron';
import { CurrencyRateService } from './economics/currency-rate.service';
import { CurrencyRateSyncCron } from './economics/currency-rate-sync.cron';
import { DailyCostAggregatorCron } from './economics/daily-cost-aggregator.cron';
import { OrgEconomicsController } from './economics/org-economics.controller';
import { OrgEconomicsCron } from './economics/org-economics.cron';
import { ProviderSmokeTestCron } from './economics/provider-smoke-test.cron';
import { UnitEconomicsService } from './economics/unit-economics.service';
import { AiUsageAdminController } from './ai-usage.controller';
import { AdminExperimentsController } from './controllers/admin-experiments.controller';
import { AdminFunctionsController } from './controllers/admin-functions.controller';
import { AdminHealthController } from './controllers/admin-health.controller';
import { AdminOrgsController } from './controllers/admin-orgs.controller';
import { AdminPricesController } from './controllers/admin-prices.controller';
import { AdminUsageController } from './controllers/admin-usage.controller';
import { OrgAdminKnowledgeController } from './controllers/org-admin-knowledge.controller';
import { OrgAdminUsageController } from './controllers/org-admin-usage.controller';
import { IntegrationKeysAdminController } from './integration-keys.controller';
import { LlmRoutesController } from './llm-routes/llm-routes.controller';
import { LlmRoutesService } from './llm-routes/llm-routes.service';
import { MeetingsAdminController } from './meetings-admin.controller';
import { AdminFeedbackController } from './prompt-templates/admin-feedback.controller';
import { AiResultFeedbackService } from './prompt-templates/ai-result-feedback.service';
import { MeetingResultFeedbackController } from './prompt-templates/meeting-result-feedback.controller';
import { AdminPromptExperimentsController } from './prompt-templates/prompt-experiments.controller';
import { PromptExperimentsService } from './prompt-templates/prompt-experiments.service';
import { AdminPromptTemplatesController } from './prompt-templates/prompt-templates.controller';
import { PromptTemplatesPreviewService } from './prompt-templates/prompt-templates-preview.service';
import { AdminPromptTemplatesService } from './prompt-templates/prompt-templates.service';
import { RecordingsAdminController } from './recordings-admin.controller';
import { AdminSettingsModule } from './settings/admin-settings.module';
import { AdminCacheService } from './services/admin-cache.service';
import { AdminExperimentsService } from './services/admin-experiments.service';
import { AdminFunctionsService } from './services/admin-functions.service';
import { AdminHealthService } from './services/admin-health.service';
import { AdminOrgsService } from './services/admin-orgs.service';
import { AdminPricesService } from './services/admin-prices.service';
import { AdminUsageService } from './services/admin-usage.service';
import { OrgAdminKnowledgeService } from './services/org-admin-knowledge.service';
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
  ],
  controllers: [
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
    // SBA α-10 wave 3 — Admin LLM + Unit Economics.
    AdminLlmProvidersController,
    AdminLlmModelsController,
    AdminEconomicsController,
    OrgEconomicsController,
    // β-9 Phase 4 — главная админка Z, глобальный Telegram-бот.
    AdminTelegramBotController,
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
