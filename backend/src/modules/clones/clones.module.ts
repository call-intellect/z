import { Global, Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { RbacModule } from '../rbac/rbac.module';

import { ClonesAdminController } from './clones-admin.controller';
import { ClonesController } from './clones.controller';
import { ClonesService } from './services/clones.service';

/**
 * SBA γ-1 — ClonesModule (Clone API).
 *
 * Эндпоинты:
 *   POST /api/v1/clones/persons/:personId/ask
 *   POST /api/v1/clones/roles/:roleId/ask
 *
 * Зависимости:
 *   - PrismaModule, RbacModule;
 *   - @Global KnowledgeCoreModule (ExecutablePersonaBuildService);
 *   - @Global AiModule (LlmRouterService);
 *   - @Global MetricsModule, RedisModule.
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
  controllers: [ClonesController, ClonesAdminController],
  providers: [ClonesService],
  exports: [ClonesService],
})
export class ClonesModule {}
