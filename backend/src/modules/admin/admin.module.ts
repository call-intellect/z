import { Global, Module } from '@nestjs/common';

import { AdminAuditInterceptor } from './admin.audit.interceptor';
import { AiUsageAdminController } from './ai-usage.controller';
import { IntegrationKeysAdminController } from './integration-keys.controller';
import { LlmRoutesController } from './llm-routes/llm-routes.controller';
import { LlmRoutesService } from './llm-routes/llm-routes.service';
import { MeetingsAdminController } from './meetings-admin.controller';
import { RecordingsAdminController } from './recordings-admin.controller';

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
  ],
  providers: [AdminAuditInterceptor, LlmRoutesService],
  exports: [AdminAuditInterceptor],
})
export class AdminModule {}
