import { Global, Module } from '@nestjs/common';

import { AuditLogService } from './audit-log.service';

/**
 * Глобальный audit-модуль. Все остальные модули могут инжектить
 * `AuditLogService` без `imports`.
 *
 * Используется в (минимум):
 *   - api-keys (CREATE/DELETE)
 *   - webhook subscriptions (CREATE/DELETE)
 *   - destinations (CRUD)
 *   - exports (CREATE/DELETE)
 *   - meetings (delete/regenerate)
 *   - shares (create/revoke/extend)
 *   - quotas (exceeded)
 */
@Global()
@Module({
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}
