import { Global, Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { TenantGuard } from './guards/tenant.guard';
import { KnowledgeAccessResolver } from './knowledge-access-resolver.service';
import { TenantMiddleware } from './middleware/tenant.middleware';
import { RbacService } from './rbac.service';

/**
 * RBAC-модуль (Фаза 0 knowledge-core).
 *
 * Глобальный — RbacService и TenantGuard доступны во всех модулях без
 * импорта RbacModule. Это правильно, потому что:
 *   - RbacService stateless (кроме in-memory кэша membership'ов);
 *   - TenantGuard используется почти во всех tenant-scoped контроллерах.
 *
 * Не экспортирует guard'ы напрямую — controller'ы используют их через
 * `@UseGuards(CookieAuthGuard, TenantGuard)`. PrismaModule — глобальный,
 * поэтому только импортируется здесь явно для ясности.
 *
 * TenantMiddleware экспортируется отдельно — регистрируется в
 * `AppModule.configure` для `api/v1/*` (выставляет `req.tenantId` ДО
 * глобальных guards SubscriptionGuard/EntitlementGuard).
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [RbacService, KnowledgeAccessResolver, TenantGuard, TenantMiddleware],
  exports: [RbacService, KnowledgeAccessResolver, TenantGuard, TenantMiddleware],
})
export class RbacModule {}
