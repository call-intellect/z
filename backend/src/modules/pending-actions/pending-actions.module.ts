import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';

import { PendingActionsController } from './pending-actions.controller';
import { ConflictPendingProvider } from './providers/conflict.provider';
import { CurationPendingProvider } from './providers/curation.provider';
import { IntakePendingProvider } from './providers/intake.provider';
import { ProbePendingProvider } from './providers/probe.provider';
import { PendingActionsService } from './services/pending-actions.service';
import { PendingActionsReminderCron } from './workers/pending-actions-reminder.cron';

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
 *   - Action Center B3: PendingActionsReminderCron использует RedisService,
 *     BusinessMetricsService, ConversationalService — все @Global, импорт не нужен.
 *     ScheduleModule.forRoot() — в AppModule (для @Cron).
 *
 * Экспортирует PendingActionsService — для будущих потребителей (Telegram,
 * дашборд CEO, ежедневный дайджест операций).
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
    // Action Center B3 — повторяющееся Telegram-напоминание о pending.
    PendingActionsReminderCron,
  ],
  exports: [PendingActionsService],
})
export class PendingActionsModule {}
