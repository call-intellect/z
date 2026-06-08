import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { WorkerOrgGate } from '../../core-queue/worker-org-gate';
import { GoalTaskLinkerService } from '../services/goal-task-linker.service';

/**
 * GoalTaskLinkerCron (agent-chain overhaul, Фаза 4.1) — догоночная авто-привязка
 * задач встречи к AI-целям.
 *
 * On-event хук в Specialist314GoalsService дёргает линкер в момент создания
 * цели, но на этот момент задач встречи может ещё не быть (tracker-триаж
 * отрабатывает позже). Этот cron подбирает остаток: свежие AI-цели с непустым
 * sourceBlockIds, у которых рядом могли появиться ungoaled-задачи.
 *
 * Раз в 30 минут. БОУНД createdAt >= now-7д — чтобы не гонять LLM-арбитра вечно
 * на старых целях (по которым задачи уже либо привязаны, либо никогда не
 * появятся). Лимит 50 целей на Org на тик. Линкер сам no-op, если у цели нет
 * ungoaled-кандидатов (дёшево, БЕЗ LLM) или если флаг
 * `goals.goalTaskLinkEnabled` выключен (DEFAULT OFF).
 *
 * Non-destructive: линкер ставит Issue.goalId только где он null —
 * идемпотентно, повторный прогон не перетирает существующие привязки.
 *
 * WorkerOrgGate: уважает тумблер `Org.workersEnabled['goal-task-linker']`.
 */
@Injectable()
export class GoalTaskLinkerCron {
  private readonly logger = new Logger(GoalTaskLinkerCron.name);
  private static readonly WORKER_NAME = 'goal-task-linker';
  private static readonly GOALS_PER_ORG_LIMIT = 50;
  private static readonly LOOKBACK_DAYS = 7;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GoalTaskLinkerService)
    private readonly linker: GoalTaskLinkerService,
    @Inject(WorkerOrgGate) private readonly gate: WorkerOrgGate,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async sweep(): Promise<void> {
    try {
      const summary = await this.scanAllOrgs();
      if (summary.linkedGoals > 0) {
        this.logger.log(
          summary,
          'goal-task-linker-cron: догоночная привязка задач завершена',
        );
      }
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'goal-task-linker-cron: непойманная ошибка — повтор через 30 мин',
      );
    }
  }

  /** Публично — для возможного ручного запуска / админ-эндпоинта. */
  async scanAllOrgs(): Promise<{
    scannedOrgs: number;
    linkedGoals: number;
  }> {
    const orgs = await this.prisma.org.findMany({
      where: {
        deletedAt: null,
        memberships: {
          some: { role: { in: ['owner', 'admin'] } },
        },
      },
      select: { id: true },
    });

    let scannedOrgs = 0;
    let linkedGoals = 0;

    const since = new Date(
      Date.now() - GoalTaskLinkerCron.LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    );

    for (const org of orgs) {
      // Тумблер Org → если выключено, пропускаем эту Org (не валим весь тик).
      try {
        await this.gate.checkOrThrow(org.id, GoalTaskLinkerCron.WORKER_NAME);
      } catch {
        continue;
      }
      scannedOrgs += 1;

      // Свежие AI-цели с блоками-источниками. Линкер сам отфильтрует те, у
      // которых нет ungoaled-задач (БЕЗ LLM) и no-op при выключенном флаге.
      const goals = await this.prisma.goal.findMany({
        where: {
          tenantId: org.id,
          source: 'ai',
          sourceBlockIds: { isEmpty: false },
          createdAt: { gte: since },
        },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
        take: GoalTaskLinkerCron.GOALS_PER_ORG_LIMIT,
      });

      for (const goal of goals) {
        try {
          const res = await this.linker.linkGoalTasks(org.id, goal.id);
          if (res.linked > 0) linkedGoals += 1;
        } catch (err) {
          this.logger.warn(
            {
              goalId: goal.id,
              tenantId: org.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'goal-task-linker-cron: ошибка на цели — продолжаю',
          );
        }
      }
    }

    return { scannedOrgs, linkedGoals };
  }
}
