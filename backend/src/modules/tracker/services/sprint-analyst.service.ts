import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import type {
  SprintDashboardDto,
  SprintDashboardMeetingRefDto,
  SprintDashboardProgressDto,
  SprintDashboardTaskRefDto,
} from '../dto/cycles/cycle-dashboard.dto';

import { TrackerEventsService } from './tracker-events.service';

/**
 * Sprints (2026-05-27) — SQL-аналитика спринта без LLM.
 *
 * Сборка `GET /api/v1/cycles/:id/dashboard`:
 *   - progress + byCategory (count по IssueState.category),
 *   - tasksWithoutDueDate / tasksAtRisk / tasksWithoutMovement (top-5 each),
 *   - linkedMeetings (Meeting WHERE linkedCycleId),
 *   - carryOverCount (distinct issueId из IssueActivity WHERE verb in
 *     ['moved_from_cycle','cycle_changed'] и toCycleId = current),
 *   - scope.label (по 4 опц. полям Project).
 *
 * Кэш Redis 5 мин по ключу `sprint:dashboard:<cycleId>`. На инвалидации
 * сбрасываем кэш и эмитим `cycle.progress_updated` event (через
 * TrackerEventsService) — OverviewCacheService поймает и сбросит
 * `project:overview:<projectId>` (см. §0 актуализированного ТЗ).
 *
 * Учёт паритета трекера: в DTO задачи отдаём `boardId`, `board.{name,color}`,
 * `checklistTotalCount/DoneCount`, `childrenCount` — фронт рисует бэйджи.
 */
@Injectable()
export class SprintAnalystService {
  private readonly logger = new Logger(SprintAnalystService.name);
  private static readonly CACHE_TTL_SECONDS = 300; // 5 мин
  private static readonly TASKS_TOPN = 5;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TrackerEventsService) private readonly events: TrackerEventsService,
    @Optional() @Inject(RedisService) private readonly redis?: RedisService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  /**
   * Главный метод: вернуть dashboard'у DTO. Если есть кэш — отдадим его.
   */
  async getSprintDashboard(args: {
    cycleId: string;
    tenantId: string;
  }): Promise<SprintDashboardDto> {
    const cacheKey = `sprint:dashboard:${args.cycleId}`;

    if (this.redis) {
      try {
        const cached = await this.redis.client.get(cacheKey);
        if (cached) {
          this.metrics?.incSprintDashboardCacheHit({ tenant: args.tenantId });
          return JSON.parse(cached) as SprintDashboardDto;
        }
      } catch (err) {
        this.logger.debug(
          {
            cycleId: args.cycleId,
            err: err instanceof Error ? err.message : String(err),
          },
          'sprint-analyst: cache read failed',
        );
      }
    }
    this.metrics?.incSprintDashboardCacheMiss({ tenant: args.tenantId });

    const dto = await this.computeDashboard(args);

    if (this.redis) {
      try {
        await this.redis.client.set(
          cacheKey,
          JSON.stringify(dto),
          'EX',
          SprintAnalystService.CACHE_TTL_SECONDS,
        );
      } catch (err) {
        this.logger.debug(
          {
            cycleId: args.cycleId,
            err: err instanceof Error ? err.message : String(err),
          },
          'sprint-analyst: cache write failed',
        );
      }
    }
    return dto;
  }

  /**
   * Сбросить кэш дашборда и эмитить `cycle.progress_updated` событие —
   * OverviewCacheService подхватит и сбросит project-overview-кэш.
   */
  async invalidateDashboardCache(cycleId: string): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.client.del(`sprint:dashboard:${cycleId}`);
      } catch {
        // graceful
      }
    }
    try {
      const cycle = await this.prisma.cycle.findUnique({
        where: { id: cycleId },
      });
      if (cycle) {
        this.events.publishCycleProgressUpdated(
          {
            id: cycle.id,
            tenantId: cycle.tenantId,
            projectId: cycle.projectId,
            name: cycle.name,
            startDate: cycle.startDate.toISOString(),
            endDate: cycle.endDate.toISOString(),
            ownedById: cycle.ownedById,
            description: cycle.description,
            progressSnapshot: cycle.progressSnapshot ?? null,
            version: cycle.version,
            timezone: cycle.timezone,
            completedAt: cycle.completedAt?.toISOString() ?? null,
            createdAt: cycle.createdAt.toISOString(),
            updatedAt: cycle.updatedAt.toISOString(),
          },
          cycle.tenantId,
        );
      }
    } catch (err) {
      this.logger.warn(
        {
          cycleId,
          err: err instanceof Error ? err.message : String(err),
        },
        'sprint-analyst: publishCycleProgressUpdated failed',
      );
    }
  }

  // ─────────────────────────── internals ───────────────────────────────

  private async computeDashboard(args: {
    cycleId: string;
    tenantId: string;
  }): Promise<SprintDashboardDto> {
    const cycle = await this.prisma.cycle.findFirst({
      where: { id: args.cycleId, tenantId: args.tenantId },
      include: {
        project: {
          include: {
            customerCard: { select: { id: true, name: true } },
            vendor: { select: { id: true, name: true } },
            subjectPerson: { select: { id: true, name: true } },
            department: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!cycle) {
      throw new Error(`cycle_not_found:${args.cycleId}`);
    }

    const scope = this.buildScopeLabel(cycle.project);

    // ── Прогресс ──
    const issues = await this.prisma.issue.findMany({
      where: {
        cycleId: cycle.id,
        tenantId: args.tenantId,
        deletedAt: null,
      },
      select: {
        id: true,
        state: { select: { category: true } },
      },
    });
    const byCategory = {
      backlog: 0,
      unstarted: 0,
      started: 0,
      completed: 0,
      cancelled: 0,
    };
    for (const i of issues) {
      const cat = i.state?.category;
      if (cat && cat in byCategory) {
        byCategory[cat as keyof typeof byCategory]++;
      } else {
        byCategory.backlog++;
      }
    }
    const total = issues.length;
    const progress: SprintDashboardProgressDto = {
      total,
      byCategory,
      ratio: total > 0 ? +(byCategory.completed / total).toFixed(3) : 0,
      durationDays: Math.max(
        1,
        Math.round(
          (cycle.endDate.getTime() - cycle.startDate.getTime()) / (1000 * 86400),
        ),
      ),
      elapsedDays: Math.max(
        0,
        Math.round(
          (Date.now() - cycle.startDate.getTime()) / (1000 * 86400),
        ),
      ),
    };

    const now = new Date();
    const horizon = new Date(now.getTime() + 2 * 86400_000);
    const movementCutoff = new Date(now.getTime() - 3 * 86400_000);

    // ── tasksWithoutDueDate ──
    const tasksWithoutDueDate = await this.fetchTaskRefs({
      where: {
        cycleId: cycle.id,
        tenantId: args.tenantId,
        deletedAt: null,
        dueDate: null,
        state: { is: { category: { notIn: ['completed', 'cancelled'] } } },
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    // ── tasksAtRisk: dueDate ≤ now+2д И не Done ──
    const tasksAtRisk = await this.fetchTaskRefs({
      where: {
        cycleId: cycle.id,
        tenantId: args.tenantId,
        deletedAt: null,
        dueDate: { lte: horizon, not: null },
        state: { is: { category: { notIn: ['completed', 'cancelled'] } } },
      },
      orderBy: [{ dueDate: 'asc' }],
    });

    // ── tasksWithoutMovement: задачи cycle, чей lastActivity < now-3д ──
    // Используем createdAt в IssueActivity (DateTime) — проще, чем bigint epoch.
    const candidateIssueIds = issues.map((i) => i.id);
    let tasksWithoutMovement: SprintDashboardTaskRefDto[] = [];
    if (candidateIssueIds.length > 0) {
      const lastActivity = await this.prisma.issueActivity.groupBy({
        by: ['issueId'],
        where: { issueId: { in: candidateIssueIds } },
        _max: { createdAt: true },
      });
      const stale = lastActivity.filter(
        (r) =>
          r._max.createdAt != null &&
          r._max.createdAt.getTime() < movementCutoff.getTime(),
      );
      if (stale.length > 0) {
        tasksWithoutMovement = await this.fetchTaskRefs({
          where: {
            id: { in: stale.map((r) => r.issueId) },
            tenantId: args.tenantId,
            deletedAt: null,
            state: { is: { category: { notIn: ['completed', 'cancelled'] } } },
          },
          orderBy: [{ updatedAt: 'asc' }],
        });
      }
    }

    // ── linkedMeetings ──
    const meetingRows = await this.prisma.meeting.findMany({
      where: {
        linkedCycleId: cycle.id,
        tenantId: args.tenantId,
        deletedAt: null,
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 20,
      select: {
        id: true,
        title: true,
        type: true,
        status: true,
        startedAt: true,
        endedAt: true,
        createdAt: true,
      },
    });
    const linkedMeetings: SprintDashboardMeetingRefDto[] = meetingRows.map((m) => ({
      id: m.id,
      title: m.title,
      type: m.type,
      status: m.status,
      startedAt: m.startedAt?.toISOString() ?? null,
      endedAt: m.endedAt?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
    }));

    // ── carryOverCount ──
    let carryOverCount = 0;
    if (candidateIssueIds.length > 0) {
      const rows = await this.prisma.issueActivity.findMany({
        where: {
          issueId: { in: candidateIssueIds },
          verb: { in: ['moved_from_cycle', 'cycle_changed'] },
          tenantId: args.tenantId,
        },
        select: { issueId: true },
        distinct: ['issueId'],
      });
      carryOverCount = rows.length;
    }

    // ── activeHintsCount ──
    const activeHintsCount = await this.prisma.sprintHint.count({
      where: {
        cycleId: cycle.id,
        tenantId: args.tenantId,
        status: 'active',
      },
    });

    return {
      cycleId: cycle.id,
      projectId: cycle.projectId,
      tenantId: cycle.tenantId,
      scope,
      progress,
      tasksWithoutDueDate,
      tasksAtRisk,
      tasksWithoutMovement,
      linkedMeetings,
      carryOverCount,
      activeHintsCount,
      generatedAt: new Date().toISOString(),
    };
  }

  private buildScopeLabel(
    project: {
      customerCard: { id: string; name: string } | null;
      vendor: { id: string; name: string } | null;
      subjectPerson: { id: string; name: string } | null;
      department: { id: string; name: string } | null;
    },
  ): SprintDashboardDto['scope'] {
    if (project.customerCard) {
      return {
        kind: 'customer',
        label: `Клиент: ${project.customerCard.name}`,
        refId: project.customerCard.id,
      };
    }
    if (project.vendor) {
      return {
        kind: 'vendor',
        label: `Поставщик: ${project.vendor.name}`,
        refId: project.vendor.id,
      };
    }
    if (project.subjectPerson) {
      return {
        kind: 'person',
        label: `Сотрудник: ${project.subjectPerson.name}`,
        refId: project.subjectPerson.id,
      };
    }
    if (project.department) {
      return {
        kind: 'department',
        label: `Отдел: ${project.department.name}`,
        refId: project.department.id,
      };
    }
    return { kind: 'org', label: 'Спринт компании', refId: null };
  }

  private async fetchTaskRefs(args: {
    where: Prisma.IssueWhereInput;
    orderBy: Prisma.IssueOrderByWithRelationInput[];
  }): Promise<SprintDashboardTaskRefDto[]> {
    const issues = await this.prisma.issue.findMany({
      where: args.where,
      orderBy: args.orderBy,
      take: SprintAnalystService.TASKS_TOPN,
      select: {
        id: true,
        identifier: true,
        title: true,
        priority: true,
        dueDate: true,
        completedAt: true,
        boardId: true,
        checklistTotalCount: true,
        checklistDoneCount: true,
        state: { select: { category: true } },
        board: { select: { id: true, name: true, color: true } },
        assignees: { select: { userId: true } },
        children: { select: { id: true } },
      },
    });
    return issues.map((i) => ({
      id: i.id,
      identifier: i.identifier,
      title: i.title,
      stateCategory:
        (i.state?.category as SprintDashboardTaskRefDto['stateCategory']) ?? null,
      priority: i.priority,
      dueDate: i.dueDate?.toISOString() ?? null,
      completedAt: i.completedAt?.toISOString() ?? null,
      assigneeUserIds: i.assignees.map((a) => a.userId),
      boardId: i.boardId ?? null,
      board: i.board
        ? { id: i.board.id, name: i.board.name, color: i.board.color }
        : null,
      checklistTotalCount: i.checklistTotalCount,
      checklistDoneCount: i.checklistDoneCount,
      childrenCount: i.children.length,
      lastActivityAt: null,
    }));
  }
}
