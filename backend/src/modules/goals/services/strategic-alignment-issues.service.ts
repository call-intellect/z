import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';

/**
 * Sprint 3 B1-3.2 — strategic alignment по задачам трекера (issue-based).
 *
 * Это ОТДЕЛЬНЫЙ механизм от существующего LLM-based
 * `knowledge-core/workers/strategic-alignment.{cron,worker}`: тот считает
 * «движение к цели» по блокам знаний (тематически), а здесь — простые
 * counted-метрики по Issue, привязанным к Goal через `Issue.goalId`.
 *
 * Поле для хранения снапшота в БД отсутствует (см. отчёт агента — поле
 * `Goal.progressSnapshot` не было добавлено в schema.prisma в рамках
 * Sprint 3 B1-3.2; решение принято осознанно — не трогать схему). Хранение:
 *   - кэш в Redis: `goal:issue-snapshot:{goalId}` с TTL 26 часов (cron гоняется
 *     раз в сутки, +2ч запас);
 *   - история — в AuditLog action `goal.alignment.issue_progress`.
 *
 * Endpoint `GET /goals/:id/alignment-snapshot` читает кэш и при cache miss
 * пересчитывает on-the-fly через `compute()`.
 */
@Injectable()
export class StrategicAlignmentIssuesService {
  private readonly logger = new Logger(StrategicAlignmentIssuesService.name);

  /** TTL Redis-кэша снапшота, секунды. cron @ 06:00 → 26 ч с запасом. */
  static readonly CACHE_TTL_SEC = 26 * 60 * 60;

  /** Окно для «свежей активности» — 7 дней (см. формулу alignmentScore). */
  static readonly RECENT_ACTIVITY_WINDOW_DAYS = 7;

  /** Окно «нет goalId» для probe-trigger — 30 дней. */
  static readonly MISALIGNMENT_WINDOW_DAYS = 30;

  /** Минимум задач у пользователя за окно, чтобы probe имел смысл. */
  static readonly MISALIGNMENT_MIN_ISSUES = 5;

  /** Доля без goalId (0..1) — порог trigger'а probe. */
  static readonly MISALIGNMENT_RATIO_THRESHOLD = 0.8;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  /**
   * Посчитать snapshot для одной цели. Метрики:
   *   - totalLinkedIssues — задач привязано, deletedAt=null.
   *   - completedIssues — state.category='completed'.
   *   - blockedIssues — state.category='blocked' (категория используется
   *     emitter'ом, см. issues.service.ts § emitIssueBlocked).
   *   - timeProgressPct — (now-createdAt)/(targetDate-createdAt)*100,
   *     null если targetDate нет. Клампится в [0..100].
   *   - alignmentScore — 0..100:
   *       50% веса — completion ratio: completedIssues/totalLinkedIssues * 50.
   *       50% веса — recency: была ли активность (Issue.updatedAt или
   *       IssueActivity.createdAt по этим задачам) за последние 7 дней.
   *     Формула простая по требованию ТЗ (B1-3.2); LLM-вариант смотри в
   *     `knowledge-core/workers/strategic-alignment.worker.ts`.
   */
  async compute(args: {
    tenantId: string;
    goalId: string;
  }): Promise<GoalIssueProgressSnapshot> {
    const goal = await this.prisma.goal.findFirst({
      where: { id: args.goalId, tenantId: args.tenantId },
      select: {
        id: true,
        tenantId: true,
        createdAt: true,
        targetDate: true,
        archivedAt: true,
        status: true,
      },
    });
    if (!goal) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'goal_not_found', message: 'Цель не найдена' },
      });
    }

    const linkedWhere = {
      tenantId: args.tenantId,
      goalId: args.goalId,
      deletedAt: null,
    };

    const [totalLinkedIssues, completedIssues, blockedIssues, recentlyUpdated] =
      await Promise.all([
        this.prisma.issue.count({ where: linkedWhere }),
        this.prisma.issue.count({
          where: { ...linkedWhere, state: { category: 'completed' } },
        }),
        this.prisma.issue.count({
          where: { ...linkedWhere, state: { category: 'blocked' } },
        }),
        this.prisma.issue.count({
          where: {
            ...linkedWhere,
            updatedAt: {
              gte: new Date(
                Date.now() -
                  StrategicAlignmentIssuesService.RECENT_ACTIVITY_WINDOW_DAYS *
                    24 *
                    60 *
                    60 *
                    1000,
              ),
            },
          },
        }),
      ]);

    const timeProgressPct = this.computeTimeProgress({
      createdAt: goal.createdAt,
      targetDate: goal.targetDate,
    });

    const alignmentScore = this.computeAlignmentScore({
      totalLinkedIssues,
      completedIssues,
      hasRecentActivity: recentlyUpdated > 0,
    });

    return {
      goalId: goal.id,
      tenantId: goal.tenantId,
      totalLinkedIssues,
      completedIssues,
      blockedIssues,
      recentlyUpdatedIssues: recentlyUpdated,
      timeProgressPct,
      alignmentScore,
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * Прочитать снапшот из Redis-кэша. Возвращает null, если кэш пуст или
   * битый JSON.
   */
  async getCached(goalId: string): Promise<GoalIssueProgressSnapshot | null> {
    try {
      const raw = await this.redis.client.get(this.cacheKey(goalId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as GoalIssueProgressSnapshot;
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof parsed.alignmentScore === 'number'
      ) {
        return parsed;
      }
      return null;
    } catch (err) {
      this.logger.warn(
        { goalId, err: err instanceof Error ? err.message : String(err) },
        'StrategicAlignmentIssuesService.getCached: ошибка чтения кэша',
      );
      return null;
    }
  }

  /** Положить снапшот в Redis с TTL `CACHE_TTL_SEC`. */
  async setCached(snapshot: GoalIssueProgressSnapshot): Promise<void> {
    try {
      await this.redis.client.set(
        this.cacheKey(snapshot.goalId),
        JSON.stringify(snapshot),
        'EX',
        StrategicAlignmentIssuesService.CACHE_TTL_SEC,
      );
    } catch (err) {
      this.logger.warn(
        {
          goalId: snapshot.goalId,
          err: err instanceof Error ? err.message : String(err),
        },
        'StrategicAlignmentIssuesService.setCached: ошибка записи кэша',
      );
    }
  }

  /**
   * Найти userId с долей задач без goalId >= MISALIGNMENT_RATIO_THRESHOLD за
   * последние 30 дней. Используется cron'ом для probe-trigger'а.
   *
   * Возвращает кандидатов вместе с метриками для прозрачности (легче
   * собрать probe-сообщение и для unit-теста).
   */
  async findMisalignedUsers(args: {
    tenantId: string;
  }): Promise<MisalignedUserCandidate[]> {
    const since = new Date(
      Date.now() -
        StrategicAlignmentIssuesService.MISALIGNMENT_WINDOW_DAYS *
          24 *
          60 *
          60 *
          1000,
    );
    // Берём issue + assignees, считаем по каждому assignee.
    const rows = await this.prisma.issue.findMany({
      where: {
        tenantId: args.tenantId,
        createdAt: { gte: since },
        deletedAt: null,
      },
      select: {
        id: true,
        goalId: true,
        assignees: { select: { userId: true } },
        createdById: true,
      },
    });
    const stats = new Map<string, { total: number; withoutGoal: number }>();
    const bump = (userId: string, hasGoal: boolean): void => {
      const s = stats.get(userId) ?? { total: 0, withoutGoal: 0 };
      s.total += 1;
      if (!hasGoal) s.withoutGoal += 1;
      stats.set(userId, s);
    };
    for (const row of rows) {
      const hasGoal = Boolean(row.goalId);
      // Если есть assignees — считаем по ним; иначе по автору задачи.
      if (row.assignees.length > 0) {
        for (const a of row.assignees) bump(a.userId, hasGoal);
      } else if (row.createdById) {
        bump(row.createdById, hasGoal);
      }
    }
    const out: MisalignedUserCandidate[] = [];
    for (const [userId, s] of stats.entries()) {
      if (s.total < StrategicAlignmentIssuesService.MISALIGNMENT_MIN_ISSUES) {
        continue;
      }
      const ratio = s.withoutGoal / s.total;
      if (ratio >= StrategicAlignmentIssuesService.MISALIGNMENT_RATIO_THRESHOLD) {
        out.push({
          userId,
          totalIssues: s.total,
          issuesWithoutGoal: s.withoutGoal,
          ratio,
        });
      }
    }
    return out;
  }

  /**
   * Узкое окно для probe-targets — собрать актуальные tenantId-ы с
   * активными goals. cron гоняется per-Org, чтобы не уйти в N+1 на больших
   * нагрузках.
   */
  async listOrgsWithActiveGoals(): Promise<string[]> {
    const rows = await this.prisma.goal.findMany({
      where: {
        archivedAt: null,
        status: { not: 'abandoned' },
      },
      distinct: ['tenantId'],
      select: { tenantId: true },
    });
    return rows.map((r) => r.tenantId);
  }

  async listActiveGoalsForOrg(tenantId: string): Promise<
    Array<{ id: string; createdById: string }>
  > {
    return this.prisma.goal.findMany({
      where: {
        tenantId,
        archivedAt: null,
        status: { not: 'abandoned' },
      },
      select: { id: true, createdById: true },
    });
  }

  // ─────────────────────────── pure helpers ───────────────────────────

  private computeTimeProgress(args: {
    createdAt: Date;
    targetDate: Date | null;
  }): number | null {
    if (!args.targetDate) return null;
    const total = args.targetDate.getTime() - args.createdAt.getTime();
    if (total <= 0) return 100;
    const elapsed = Date.now() - args.createdAt.getTime();
    const pct = (elapsed / total) * 100;
    if (pct < 0) return 0;
    if (pct > 100) return 100;
    return Math.round(pct * 100) / 100;
  }

  private computeAlignmentScore(args: {
    totalLinkedIssues: number;
    completedIssues: number;
    hasRecentActivity: boolean;
  }): number {
    if (args.totalLinkedIssues === 0) {
      // Нет задач — alignment не вычисляется. Возвращаем 0 (UI покажет
      // «Подключите задачи»).
      return 0;
    }
    const completionPart =
      (args.completedIssues / args.totalLinkedIssues) * 50;
    const recencyPart = args.hasRecentActivity ? 50 : 0;
    const score = Math.round(completionPart + recencyPart);
    if (score < 0) return 0;
    if (score > 100) return 100;
    return score;
  }

  private cacheKey(goalId: string): string {
    return `goal:issue-snapshot:${goalId}`;
  }
}

/**
 * Тип снапшота issue-based alignment. Совместим с DTO API endpoint'а
 * `GET /goals/:id/alignment-snapshot`.
 */
export interface GoalIssueProgressSnapshot {
  goalId: string;
  tenantId: string;
  totalLinkedIssues: number;
  completedIssues: number;
  blockedIssues: number;
  recentlyUpdatedIssues: number;
  /** Доля прошедшего времени между createdAt и targetDate, %; null если нет targetDate. */
  timeProgressPct: number | null;
  /** 0..100, формула в {@link StrategicAlignmentIssuesService.computeAlignmentScore}. */
  alignmentScore: number;
  /** ISO 8601 UTC. */
  computedAt: string;
}

export interface MisalignedUserCandidate {
  userId: string;
  totalIssues: number;
  issuesWithoutGoal: number;
  /** withoutGoal / total, 0..1. */
  ratio: number;
}
