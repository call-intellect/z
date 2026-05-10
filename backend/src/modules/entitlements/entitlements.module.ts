import { Global, Module } from '@nestjs/common';

import { EntitlementGuard } from './entitlement.guard';
import { EntitlementService } from './entitlement.service';
import { EntitlementsController } from './entitlements.controller';

/**
 * EntitlementsModule (Фаза 12 knowledge-core).
 *
 * Глобальный модуль: `EntitlementService` нужен в десятках мест (chat, exports,
 * sources, ingest, dashboard и т.д.), а `EntitlementGuard` — APP_GUARD-провайдер
 * в AppModule.
 *
 * Зависимости (все @Global, не нужно в imports):
 *   - PrismaModule, RedisModule — инфраструктура.
 *   - AuditModule — за `AuditLogService` (mutate-методы пишут TIER_CHANGED /
 *     ENTITLEMENT_OVERRIDE_SET).
 *   - RbacModule — `RbacService.canManageOrg` для owner-проверки на
 *     `/settings/billing`.
 *
 * Controllers:
 *   - EntitlementsController — `/me/entitlements`, `/settings/billing`,
 *     `/admin/orgs/:tenantId/entitlement` (super_admin).
 */
@Global()
@Module({
  controllers: [EntitlementsController],
  providers: [EntitlementService, EntitlementGuard],
  exports: [EntitlementService, EntitlementGuard],
})
export class EntitlementsModule {}
