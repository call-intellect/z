import { Global, Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { TenantGuard } from './guards/tenant.guard';
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
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [RbacService, TenantGuard],
  exports: [RbacService, TenantGuard],
})
export class RbacModule {}
