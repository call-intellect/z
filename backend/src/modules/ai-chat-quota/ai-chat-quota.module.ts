import { Global, Module } from '@nestjs/common';

import { QuotasModule } from '../quotas/quotas.module';
import { RbacModule } from '../rbac/rbac.module';

import { AiChatQuotaController } from './ai-chat-quota.controller';
import { AiChatQuotaService } from './ai-chat-quota.service';

/**
 * Global module: AiChatQuotaService доступен по всему приложению без
 * явного импорта. Использует QuotaService (Redis INCR) и RbacService
 * (resolve роли пользователя в Org).
 *
 * Контроллер `AiChatQuotaController` отдаёт UI-эндпоинт
 * `GET /api/v1/me/ai-chat/quota`. `CookieAuthGuard` и `TenantGuard`
 * приходят из глобальных `AuthModule` / `RbacModule` (оба `@Global()`),
 * поэтому здесь импортируется только `RbacModule` ради явной зависимости
 * сервиса от `RbacService`.
 */
@Global()
@Module({
  imports: [QuotasModule, RbacModule],
  controllers: [AiChatQuotaController],
  providers: [AiChatQuotaService],
  exports: [AiChatQuotaService],
})
export class AiChatQuotaModule {}
