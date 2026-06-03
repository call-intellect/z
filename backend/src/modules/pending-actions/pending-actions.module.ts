import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { PendingActionsController } from './pending-actions.controller';
import { ConflictPendingProvider } from './providers/conflict.provider';
import { CurationPendingProvider } from './providers/curation.provider';
import { IntakePendingProvider } from './providers/intake.provider';
import { ProbePendingProvider } from './providers/probe.provider';
import { PendingActionsService } from './services/pending-actions.service';

/**
 * PendingActionsModule (Action Center B0, 2026-06-02).
 *
 * Единый агрегатор «что требует действия пользователя» — фундамент Части B
 * (бейдж, колокольчик, дашборд CEO, Telegram).
 *
 * Зависимости:
 *   - PrismaModule — провайдеры читают read-models (CurationItem / ConflictItem
 *     / IntakeIssue / Notification) напрямую, tenant-scoped, без feature-сервисов.
 *   - CookieAuthGuard / TenantGuard / @CurrentOrg — auth (@Global RbacModule).
 *
 * Экспортирует PendingActionsService — для будущих потребителей (Telegram,
 * дашборд CEO).
 */
@Module({
  imports: [PrismaModule],
  controllers: [PendingActionsController],
  providers: [
    PendingActionsService,
    CurationPendingProvider,
    ConflictPendingProvider,
    IntakePendingProvider,
    ProbePendingProvider,
  ],
  exports: [PendingActionsService],
})
export class PendingActionsModule {}
