import { Module } from '@nestjs/common';

import { CoreQueueModule } from '../core-queue/core-queue.module';
import { RoleProfileCron } from '../knowledge-core/workers/role-profile.cron';
import { RoleProfileWorker } from '../knowledge-core/workers/role-profile.worker';

import { RoleProfileContextBuilder } from './services/context-builder.service';
import { RoleProfileService } from './services/role-profile.service';

/**
 * RoleProfileAgent (Фаза 0d) — модуль воркера + cron + service.
 *
 * **Не путать** с модулем `RoleProfilesModule` (CRUD API `/api/v1/role-profiles`)
 * — он отдельный (создаётся параллельно в Фазе 0a.3). Этот модуль содержит
 * только агентскую логику (BullMQ consumer + cron + LLM-вызов).
 *
 * Зависимости (все @Global, доступны без явного import):
 *   - PrismaModule (для prisma access)
 *   - RedisModule (BullMQ connection)
 *   - AiModule (LlmRouterService)
 *   - GraphModule (когда будет использоваться через GraphService.traverse)
 *
 * Регистрируется в `AppModule` после `WorkersModule`. Воркер запускается
 * in-process (см. AppModule §214 — `// AI/knowledge-core воркеры и cron'ы —
 * IN-PROCESS`).
 *
 * См. plans/tz/2026-05-21-phase-0d-role-profile-agent.md.
 */
@Module({
  imports: [CoreQueueModule],
  providers: [
    RoleProfileService,
    RoleProfileContextBuilder,
    RoleProfileWorker,
    RoleProfileCron,
  ],
  exports: [RoleProfileService],
})
export class RoleProfilesAgentModule {}
