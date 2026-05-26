import { Global, Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { RbacModule } from '../rbac/rbac.module';

import { ClonesAdminController } from './clones-admin.controller';
import { ClonesController, MeCloneAccessController } from './clones.controller';
import { ClonesAdminService } from './services/clones-admin.service';
import { ClonesService } from './services/clones.service';

/**
 * SBA γ-1 — ClonesModule (Clone API).
 *
 * Эндпоинты:
 *   POST /api/v1/clones/persons/:personId/ask
 *   POST /api/v1/clones/roles/:roleId/ask
 *   ТЗ 2026-05-26 — admin-CRUD `/api/v1/admin/clones/access-grants/*` и
 *   user-эндпоинт `GET /api/v1/me/clone-access`.
 *
 * Зависимости:
 *   - PrismaModule, RbacModule;
 *   - @Global KnowledgeCoreModule (ExecutablePersonaBuildService);
 *   - @Global AiModule (LlmRouterService);
 *   - @Global MetricsModule, RedisModule;
 *   - @Global ConversationalModule (ConversationalService — для in-app
 *     уведомления `clone.access_granted` из `ClonesAdminService`).
 *
 * Помечен `@Global()`, чтобы `SynthesisService` (ChatV2Module) мог инжектить
 * `ClonesService` через `@Optional()` без явного импорта ClonesModule в ChatV2Module
 * (избегаем circular: ChatV2Module → ClonesModule → KnowledgeCoreModule → ChatV2Module).
 *
 * Регистрируется в AppModule ПОСЛЕ KnowledgeCoreModule и RbacModule.
 */
@Global()
@Module({
  imports: [PrismaModule, RbacModule],
  controllers: [
    ClonesController,
    ClonesAdminController,
    // ТЗ 2026-05-26 §2.6 — отдельный controller для `/api/v1/me/clone-access`
    // (другой URL-префикс, не /clones).
    MeCloneAccessController,
  ],
  providers: [ClonesService, ClonesAdminService],
  exports: [ClonesService, ClonesAdminService],
})
export class ClonesModule {}
