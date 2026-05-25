import { Module } from '@nestjs/common';

import { AdminAuditController } from './admin-audit.controller';
import { AdminAuditService } from './admin-audit.service';

/**
 * Admin-redesign Фаза 1 — `AdminAuditModule`.
 *
 * Чистый GET-only модуль на чтение `SuperAdminAccessLog`. Импортируется
 * `AdminModule`. Прав на запись не предоставляет — записи туда пишут
 * `SuperAdminAuditInterceptor` и mutating-сервисы.
 */
@Module({
  controllers: [AdminAuditController],
  providers: [AdminAuditService],
  exports: [AdminAuditService],
})
export class AdminAuditModule {}
