import { Global, Module } from '@nestjs/common';

import { CryptoModule } from '../../common/crypto/crypto.module';

import { AdminAuditInterceptor } from './admin.audit.interceptor';
import { AdminAiModule } from './ai/ai.module';
import { AdminAiModelsController } from './ai-models/ai-models.controller';
import { AdminAiModelsService } from './ai-models/ai-models.service';
import { AiUsageAdminController } from './ai-usage.controller';
import { AnalyticsModule } from './analytics/analytics.module';
import { AdminAuditModule } from './audit/admin-audit.module';
import { ContentAdminModule } from './content/content-admin.module';
import { AdminDemoController } from './controllers/admin-demo.controller';
import { AdminFunctionsController } from './controllers/admin-functions.controller';
import { AdminHealthController } from './controllers/admin-health.controller';
import { AdminOrgsController } from './controllers/admin-orgs.controller';
import { AdminPricesController } from './controllers/admin-prices.controller';
import { AdminUsageController } from './controllers/admin-usage.controller';
import { OrgAdminKnowledgeController } from './controllers/org-admin-knowledge.controller';
import { OrgAdminMemoryAccessController } from './controllers/org-admin-memory-access.controller';
import { AdminCronsModule } from './crons/admin-crons.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { AdminEconomicsController } from './economics/admin-economics.controller';
import { AdminEmbeddingProvidersController } from './economics/admin-embedding-providers.controller';
import { AdminEmbeddingProvidersService } from './economics/admin-embedding-providers.service';
import { AdminLlmModelsController } from './economics/admin-llm-models.controller';
import { AdminLlmModelsService } from './economics/admin-llm-models.service';
import { AdminLlmProvidersController } from './economics/admin-llm-providers.controller';
import { AdminLlmProvidersService } from './economics/admin-llm-providers.service';
import { BudgetAlertCron } from './economics/budget-alert.cron';
import { CurrencyRateSyncCron } from './economics/currency-rate-sync.cron';
import { CurrencyRateModule } from './economics/currency-rate.module';
import { DailyCostAggregatorCron } from './economics/daily-cost-aggregator.cron';
import { LlmCostDashboardController } from './economics/llm-cost-dashboard.controller';
import { LlmCostDashboardService } from './economics/llm-cost-dashboard.service';
import { OrgEconomicsController } from './economics/org-economics.controller';
import { OrgEconomicsCron } from './economics/org-economics.cron';
import { ProviderSmokeTestCron } from './economics/provider-smoke-test.cron';
import { UnitEconomicsService } from './economics/unit-economics.service';
import { AdminEntitlementsModule } from './entitlements/entitlements.module';
import { AdminIncidentsModule } from './incidents/admin-incidents.module';
import { IntegrationKeysAdminController } from './integration-keys.controller';
import { IntegrationsAdminModule } from './integrations/integrations-admin.module';
import { LlmPreferenceDatasetController } from './llm-preference-dataset/llm-preference-dataset.controller';
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

@Global()
@Module({
  imports: [
    AdminSettingsModule,
    AdminCronsModule,
    AdminAuditModule,
    AdminIncidentsModule,
    AnalyticsModule,
    AdminAiModule,
    AdminPlansModule,
    AdminEntitlementsModule,
    ContentAdminModule,
    IntegrationsAdminModule,
    AdminMediaModule,
    PlatformAdminModule,
    AdminSkillTraitConceptsModule,
    OnboardingModule,
    CryptoModule,
    CurrencyRateModule,
  ],
  controllers: [
    AdminDemoController,
    IntegrationKeysAdminController,
    MeetingsAdminController,
    AiUsageAdminController,
    RecordingsAdminController,
    AdminAiModelsController,
    AdminPromptTemplatesController,
    AdminPromptExperimentsController,
    AdminFeedbackController,
    MeetingResultFeedbackController,
    AdminUsageController,
    AdminFunctionsController,
    AdminPricesController,
    AdminOrgsController,
    AdminHealthController,
    OrgAdminKnowledgeController,
    OrgAdminMemoryAccessController,
    AdminLlmProvidersController,
    AdminLlmModelsController,
    AdminEmbeddingProvidersController,
    AdminEconomicsController,
    LlmCostDashboardController,
    OrgEconomicsController,
    AdminTelegramBotController,
    LlmPreferenceDatasetController,
    SignalTypeMonitorController,
  ],
  providers: [
    AdminAuditInterceptor,
    SuperAdminAuditInterceptor,
    AdminAiModelsService,
    AdminPromptTemplatesService,
    PromptTemplatesPreviewService,
    PromptExperimentsService,
    AiResultFeedbackService,
    AdminCacheService,
    AdminUsageService,
    AdminFunctionsService,
    AdminPricesService,
    AdminOrgsService,
    AdminHealthService,
    OrgAdminKnowledgeService,
    AdminLlmProvidersService,
    AdminLlmModelsService,
    AdminEmbeddingProvidersService,
    UnitEconomicsService,
    LlmCostDashboardService,
    DailyCostAggregatorCron,
    OrgEconomicsCron,
    BudgetAlertCron,
    CurrencyRateSyncCron,
    ProviderSmokeTestCron,
    AdminTelegramBotService,
    SignalTypeMonitorService,
  ],
  exports: [
    AdminAuditInterceptor,
    SuperAdminAuditInterceptor,
    AdminCacheService,
    AdminUsageService,
    AdminFunctionsService,
    AdminPricesService,
    AdminOrgsService,
    AdminHealthService,
    OrgAdminKnowledgeService,
    PromptExperimentsService,
    AiResultFeedbackService,
    AdminLlmProvidersService,
    AdminLlmModelsService,
    UnitEconomicsService,
    CurrencyRateModule,
    DailyCostAggregatorCron,
    OrgEconomicsCron,
    BudgetAlertCron,
    CurrencyRateSyncCron,
    ProviderSmokeTestCron,
  ],
})
export class AdminModule {}
