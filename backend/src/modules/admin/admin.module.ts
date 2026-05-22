import { Global, Module } from '@nestjs/common';

import { AdminAuditInterceptor } from './admin.audit.interceptor';
import { AdminAiModelsController } from './ai-models/ai-models.controller';
import { AdminAiModelsService } from './ai-models/ai-models.service';
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
import { AdminCacheService } from './services/admin-cache.service';
import { AdminExperimentsService } from './services/admin-experiments.service';
import { AdminFunctionsService } from './services/admin-functions.service';
import { AdminHealthService } from './services/admin-health.service';
import { AdminOrgsService } from './services/admin-orgs.service';
import { AdminPricesService } from './services/admin-prices.service';
import { AdminUsageService } from './services/admin-usage.service';
import { OrgAdminKnowledgeService } from './services/org-admin-knowledge.service';
import { SuperAdminAuditInterceptor } from './super-admin.audit.interceptor';

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
  ],
})
export class AdminModule {}
