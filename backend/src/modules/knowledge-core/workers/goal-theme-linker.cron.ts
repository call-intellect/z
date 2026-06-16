import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { WorkerOrgGate } from '../../core-queue/worker-org-gate';
import { GoalThemeLinkerService } from '../services/goal-theme-linker.service';

/**
 * GoalThemeLinkerCron (agent-chain overhaul, Фаза 4.2) — догоночная авто-привязка
 * тем к AI-целям без единой темы.
 *
 * On-event хук в Specialist314GoalsService привязывает темы в момент создания
 * цели, но к этому моменту тема/провенанс/co-mention могут быть ещё не готовы
 * (theme-clusterer / entity-graph отрабатывают позже). Этот cron подбирает
 * остаток: AI-цели с непустым sourceBlockIds, у которых нет ни одной GoalTheme.
 *
 * Раз в 30 минут. Лимит 50 целей на Org на тик. Идемпотентно: повторный прогон
 * не создаёт дублей (GoalTheme PK + skipDuplicates в линкере); как только у
 * цели появилась хотя бы одна тема — фильтр `themes: { none: {} }` её исключает.
 *
 * WorkerOrgGate: уважает тумблер `Org.workersEnabled['goal-theme-linker']`.
 */
@Injectable()
export class GoalThemeLinkerCron {
  private readonly logger = new Logger(GoalThemeLinkerCron.name);
  private static readonly WORKER_NAME = 'goal-theme-linker';
  private static readonly GOALS_PER_ORG_LIMIT = 50;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GoalThemeLinkerService)
    private readonly linker: GoalThemeLinkerService,
    @Inject(WorkerOrgGate) private readonly gate: WorkerOrgGate,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async sweep(): Promise<void> {
    try {
      const summary = await this.scanAllOrgs();
      if (summary.linkedGoals > 0) {
        this.logger.debug(
          summary,
          'goal-theme-linker-cron: догоночная привязка завершена',
        );
      }
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'goal-theme-linker-cron: непойманная ошибка — повтор через 30 мин',
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

    for (const org of orgs) {
      // Тумблер Org → если выключено, пропускаем эту Org (не валим весь тик).
      try {
        await this.gate.checkOrThrow(org.id, GoalThemeLinkerCron.WORKER_NAME);
      } catch {
        continue;
      }
      scannedOrgs += 1;

      // AI-цели с блоками-источниками, но без единой темы (GoalTheme).
      const goals = await this.prisma.goal.findMany({
        where: {
          tenantId: org.id,
          source: 'ai',
          sourceBlockIds: { isEmpty: false },
          themes: { none: {} },
        },
        select: { id: true },
        take: GoalThemeLinkerCron.GOALS_PER_ORG_LIMIT,
      });

      for (const goal of goals) {
        try {
          const res = await this.linker.linkGoalThemes(org.id, goal.id);
          if (res.linked > 0) linkedGoals += 1;
        } catch (err) {
          this.logger.warn(
            {
              goalId: goal.id,
              tenantId: org.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'goal-theme-linker-cron: ошибка на цели — продолжаю',
          );
        }
      }
    }

    return { scannedOrgs, linkedGoals };
  }
}
