import { Global, Module } from '@nestjs/common';

import { ConfigModule } from '../../common/config/index';
import { PrismaModule } from '../../common/prisma/prisma.module';

import { EntitlementService } from './entitlement.service';

/**
 * @Global-обёртка над EntitlementService для worker-процесса.
 *
 * Полный `EntitlementsModule` импортировать в воркер нельзя — он несёт
 * `EntitlementsController` с `CookieAuthGuard` (→ JwtService и весь auth-стек).
 * Воркеру нужен только сам `EntitlementService` (его требует `MeetingsService` и
 * `IngestService`, Фаза 12). Зависимости EntitlementService — Prisma / Redis /
 * AuditLogService — все @Global.
 *
 * Импортируется ТОЛЬКО в `WorkersModule` (на HTTP — обычный EntitlementsModule).
 */
@Global()
@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [EntitlementService],
  exports: [EntitlementService],
})
export class EntitlementGlobalModule {}
