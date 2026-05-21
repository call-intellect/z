import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { CoreQueueModule } from '../core-queue/core-queue.module';

import { RoleProfilesController } from './role-profiles.controller';
import { RoleProfilesService } from './services/role-profiles.service';

/**
 * RoleProfilesModule (Фаза 0a — карта должности, observed-форма) +
 * подключение к BullMQ-очереди `core.role-profile` (Фаза 0d).
 *
 * Стало: чтение/list/detail/rebuild/build-status — все полноценные.
 *   - `rebuild` → enqueue в `core.role-profile` через `CoreQueueService.enqueueRoleProfile`.
 *   - `build-status` → poll через `CoreQueueService.findActiveRoleProfileJob` + lastBuildAt из БД.
 *   - 409 Conflict если уже есть active/queued job (см. plans/tz/2026-05-21-phase-0d-role-profile-agent.md §8).
 *
 * Воркер живёт в `RoleProfilesAgentModule` (knowledge-core/workers/role-profile.worker.ts).
 */
@Module({
  imports: [PrismaModule, CoreQueueModule],
  controllers: [RoleProfilesController],
  providers: [RoleProfilesService],
  exports: [RoleProfilesService],
})
export class RoleProfilesModule {}
