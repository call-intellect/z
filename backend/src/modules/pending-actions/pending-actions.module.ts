import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { CurationModule } from '../curation/curation.module';
import { TrackerModule } from '../tracker/tracker.module';

import { PendingActionsController } from './pending-actions.controller';
import { ConflictPendingProvider } from './providers/conflict.provider';
import { CurationPendingProvider } from './providers/curation.provider';
import { IntakePendingProvider } from './providers/intake.provider';
import { ProbePendingProvider } from './providers/probe.provider';
import { ProgressDraftPendingProvider } from './providers/progress-draft.provider';
import { TaskClosurePendingProvider } from './providers/task-closure.provider';
import { TaskReviewPendingProvider } from './providers/task-review.provider';
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
 *   - Action Center B4: CurationModule (экспортирует CurationService) — делегат
 *     быстрого подтверждения light-curation (POST /pending-actions/confirm).
 *
 * Экспортирует PendingActionsService — для будущих потребителей (Telegram,
 * дашборд CEO, ежедневный дайджест операций).
 */
@Module({
  // Action Center B4 — CurationModule экспортирует CurationService + ConflictService
  // (делегаты резолва). Редизайн Ф4 — TrackerModule экспортирует IntakeService
  // (резолв intake через triage). ConversationalService — @Global (respondToProbe).
  // Цикла нет: curation/tracker НЕ импортируют pending-actions.
  imports: [PrismaModule, CurationModule, TrackerModule],
  controllers: [PendingActionsController],
  providers: [
    PendingActionsService,
    CurationPendingProvider,
    ConflictPendingProvider,
    IntakePendingProvider,
    ProbePendingProvider,
    // TZ task-dedup (2026-06-16, Ф2) — задачи-кандидаты на закрытие из разговора.
    TaskClosurePendingProvider,
    // TZ task-dedup (2026-06-16, Ф4) — задачи «под вопросом» после отмены решения.
    TaskReviewPendingProvider,
    // TZ tracker-redesign (2026-06-20, Ф8/R17a) — авто-черновики прогресса задач.
    ProgressDraftPendingProvider,
    // Action Center B3 — повторяющееся Telegram-напоминание о pending.
    PendingActionsReminderCron,
  ],
  exports: [PendingActionsService],
})
export class PendingActionsModule {}
