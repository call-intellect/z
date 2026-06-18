import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import type {
  SprintActivityColor,
  SprintDailyDigestDto,
  SprintDailyIssueWithActivityDto,
  SprintDailyTopCloserDto,
  SprintDailyTopHelperDto,
} from '../dto/cycles/cycle-daily.dto';
import type {
  SprintDashboardDto,
  SprintDashboardMeetingRefDto,
  SprintDashboardProgressDto,
  SprintDashboardTaskRefDto,
} from '../dto/cycles/cycle-dashboard.dto';
import type {
  SprintWeeklyDigestDto,
  SprintWeeklyForecastDto,
  SprintWeeklyLearningDto,
  SprintWeeklyTeamHealthRowDto,
  SprintWeeklyVelocityDto,
} from '../dto/cycles/cycle-weekly.dto';
import {
  SPRINT_DAILY_DIGEST_SYSTEM_PROMPT,
  buildSprintDailyDigestUserMessage,
} from '../prompts/sprint-daily-digest.prompt';
import {
  SPRINT_WEEKLY_DIGEST_SYSTEM_PROMPT,
  buildSprintWeeklyDigestUserMessage,
} from '../prompts/sprint-weekly-digest.prompt';

import { TrackerEventsService } from './tracker-events.service';

@Injectable()
export class SprintAnalystService {
  private readonly logger = new Logger(SprintAnalystService.name);
  private static readonly CACHE_TTL_SECONDS = 300;
  private static readonly TASKS_TOPN = 5;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TrackerEventsService) private readonly events: TrackerEventsService,
    @Optional() @Inject(RedisService) private readonly redis?: RedisService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
    @Optional()
    @Inject(LlmRouterService)
    private readonly llm?: LlmRouterService,
  ) {}

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

  async invalidateDashboardCache(cycleId: string): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.client.del(`sprint:dashboard:${cycleId}`);
      } catch {}
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
            primaryGoalId: cycle.primaryGoalId,
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
        Math.round((cycle.endDate.getTime() - cycle.startDate.getTime()) / (1000 * 86400)),
      ),
      elapsedDays: Math.max(
        0,
        Math.round((Date.now() - cycle.startDate.getTime()) / (1000 * 86400)),
      ),
    };

    const now = new Date();
    const horizon = new Date(now.getTime() + 2 * 86400_000);
    const movementCutoff = new Date(now.getTime() - 3 * 86400_000);

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

    const candidateIssueIds = issues.map((i) => i.id);
    let tasksWithoutMovement: SprintDashboardTaskRefDto[] = [];
    if (candidateIssueIds.length > 0) {
      const lastActivity = await this.prisma.issueActivity.groupBy({
        by: ['issueId'],
        where: { issueId: { in: candidateIssueIds } },
        _max: { createdAt: true },
      });
      const stale = lastActivity.filter(
        (r) => r._max.createdAt != null && r._max.createdAt.getTime() < movementCutoff.getTime(),
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

  private buildScopeLabel(project: {
    customerCard: { id: string; name: string } | null;
    vendor: { id: string; name: string } | null;
    subjectPerson: { id: string; name: string } | null;
    department: { id: string; name: string } | null;
  }): SprintDashboardDto['scope'] {
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
      stateCategory: (i.state?.category as SprintDashboardTaskRefDto['stateCategory']) ?? null,
      priority: i.priority,
      dueDate: i.dueDate?.toISOString() ?? null,
      completedAt: i.completedAt?.toISOString() ?? null,
      assigneeUserIds: i.assignees.map((a) => a.userId),
      boardId: i.boardId ?? null,
      board: i.board ? { id: i.board.id, name: i.board.name, color: i.board.color } : null,
      checklistTotalCount: i.checklistTotalCount,
      checklistDoneCount: i.checklistDoneCount,
      childrenCount: i.children.length,
      lastActivityAt: null,
    }));
  }

  private static readonly DAILY_CACHE_TTL_SECONDS = 60;
  private static readonly WEEKLY_CACHE_TTL_SECONDS = 300;
  private static readonly DAY_MS = 86_400_000;

  async getDailyDigest(args: { cycleId: string; tenantId: string }): Promise<SprintDailyDigestDto> {
    const cacheKey = `sprint:dashboard:daily:${args.cycleId}`;

    if (this.redis) {
      try {
        const cached = await this.redis.client.get(cacheKey);
        if (cached) {
          return JSON.parse(cached) as SprintDailyDigestDto;
        }
      } catch (err) {
        this.logger.debug(
          {
            cycleId: args.cycleId,
            err: err instanceof Error ? err.message : String(err),
          },
          'sprint-analyst: daily cache read failed',
        );
      }
    }

    const dto = await this.computeDailyDigest(args);

    if (this.redis) {
      try {
        await this.redis.client.set(
          cacheKey,
          JSON.stringify(dto),
          'EX',
          SprintAnalystService.DAILY_CACHE_TTL_SECONDS,
        );
      } catch (err) {
        this.logger.debug(
          {
            cycleId: args.cycleId,
            err: err instanceof Error ? err.message : String(err),
          },
          'sprint-analyst: daily cache write failed',
        );
      }
    }
    return dto;
  }

  private async computeDailyDigest(args: {
    cycleId: string;
    tenantId: string;
  }): Promise<SprintDailyDigestDto> {
    const cycle = await this.prisma.cycle.findFirst({
      where: { id: args.cycleId, tenantId: args.tenantId },
    });
    if (!cycle) {
      throw new Error(`cycle_not_found:${args.cycleId}`);
    }

    const hypothesisText = this.extractHypothesisText(cycle.description);

    const issues = await this.prisma.issue.findMany({
      where: {
        cycleId: cycle.id,
        tenantId: args.tenantId,
        deletedAt: null,
        state: { is: { category: { notIn: ['completed', 'cancelled'] } } },
      },
      select: {
        id: true,
        identifier: true,
        title: true,
        updatedAt: true,
        state: { select: { category: true } },
        assignees: {
          select: {
            userId: true,
          },
          take: 1,
        },
      },
      take: 50,
    });

    const issueIds = issues.map((i) => i.id);
    const lastActivityMap = new Map<string, Date>();
    if (issueIds.length > 0) {
      const groups = await this.prisma.issueActivity.groupBy({
        by: ['issueId'],
        where: { issueId: { in: issueIds }, tenantId: args.tenantId },
        _max: { createdAt: true },
      });
      for (const g of groups) {
        if (g._max.createdAt) {
          lastActivityMap.set(g.issueId, g._max.createdAt);
        }
      }
    }

    const assigneeUserIds = Array.from(
      new Set(issues.flatMap((i) => i.assignees.map((a) => a.userId))),
    );
    const userNameMap = await this.resolveUserNames(assigneeUserIds);

    const issuesWithActivity: SprintDailyIssueWithActivityDto[] = issues.map((i) => {
      const last = lastActivityMap.get(i.id) ?? i.updatedAt;
      const firstAssignee = i.assignees[0]?.userId ?? null;
      return {
        issueId: i.id,
        identifier: i.identifier,
        title: i.title,
        assigneeName: firstAssignee ? (userNameMap.get(firstAssignee) ?? null) : null,
        lastActivity: last.toISOString(),
        activityColor: this.activityColor(last, new Date()),
        stateCategory:
          (i.state?.category as SprintDailyIssueWithActivityDto['stateCategory']) ?? null,
      };
    });

    const topClosers = await this.computeTopClosers({
      tenantId: args.tenantId,
      cycleId: cycle.id,
      from: cycle.startDate,
      to: new Date(),
    });

    const topHelpers = await this.computeTopHelpers({
      tenantId: args.tenantId,
      from: cycle.startDate,
      to: new Date(),
    });

    const alarmCount = await this.prisma.sprintHint.count({
      where: {
        cycleId: cycle.id,
        tenantId: args.tenantId,
        status: 'active',
        OR: [{ severity: 'critical' }, { kind: 'due_date_at_risk' }],
      },
    });

    const allIssuesForProgress = await this.prisma.issue.findMany({
      where: {
        cycleId: cycle.id,
        tenantId: args.tenantId,
        deletedAt: null,
      },
      select: { id: true, state: { select: { category: true } } },
    });
    let completed = 0;
    let inProgress = 0;
    for (const i of allIssuesForProgress) {
      const cat = i.state?.category;
      if (cat === 'completed') completed++;
      else if (cat === 'started') inProgress++;
    }
    const total = allIssuesForProgress.length;

    const now = new Date();
    const elapsedDays = Math.max(
      0,
      Math.round((now.getTime() - cycle.startDate.getTime()) / SprintAnalystService.DAY_MS),
    );
    const durationDays = Math.max(
      1,
      Math.round(
        (cycle.endDate.getTime() - cycle.startDate.getTime()) / SprintAnalystService.DAY_MS,
      ),
    );

    const carryOverCount = await this.computeCarryOver({
      tenantId: args.tenantId,
      cycleId: cycle.id,
      issueIds: allIssuesForProgress.map((i) => i.id),
    });

    const activeHintsCount = await this.prisma.sprintHint.count({
      where: {
        cycleId: cycle.id,
        tenantId: args.tenantId,
        status: 'active',
      },
    });

    const topRisks = issuesWithActivity
      .filter((i) => i.activityColor !== 'success')
      .slice(0, 5)
      .map((i) => i.title);
    const topStale = issuesWithActivity
      .filter((i) => i.activityColor === 'danger')
      .slice(0, 5)
      .map((i) => i.title);

    const aiNarrative = await this.generateDailyNarrative({
      tenantId: args.tenantId,
      cycleName: cycle.name,
      hypothesisText,
      elapsedDays,
      durationDays,
      total,
      completed,
      inProgress,
      activeHintsCount,
      alarmCount,
      topRisks,
      topStale,
      carryOverCount,
    });

    return {
      cycleId: cycle.id,
      hypothesisText,
      aiNarrative,
      issuesWithActivity,
      topClosers,
      topHelpers,
      alarmCount,
      generatedAt: new Date().toISOString(),
    };
  }

  async getWeeklyDigest(args: {
    cycleId: string;
    tenantId: string;
  }): Promise<SprintWeeklyDigestDto> {
    const cacheKey = `sprint:dashboard:weekly:${args.cycleId}`;

    if (this.redis) {
      try {
        const cached = await this.redis.client.get(cacheKey);
        if (cached) return JSON.parse(cached) as SprintWeeklyDigestDto;
      } catch (err) {
        this.logger.debug(
          {
            cycleId: args.cycleId,
            err: err instanceof Error ? err.message : String(err),
          },
          'sprint-analyst: weekly cache read failed',
        );
      }
    }

    const dto = await this.computeWeeklyDigest(args);

    if (this.redis) {
      try {
        await this.redis.client.set(
          cacheKey,
          JSON.stringify(dto),
          'EX',
          SprintAnalystService.WEEKLY_CACHE_TTL_SECONDS,
        );
      } catch (err) {
        this.logger.debug(
          {
            cycleId: args.cycleId,
            err: err instanceof Error ? err.message : String(err),
          },
          'sprint-analyst: weekly cache write failed',
        );
      }
    }
    return dto;
  }

  private async computeWeeklyDigest(args: {
    cycleId: string;
    tenantId: string;
  }): Promise<SprintWeeklyDigestDto> {
    const cycle = await this.prisma.cycle.findFirst({
      where: { id: args.cycleId, tenantId: args.tenantId },
    });
    if (!cycle) {
      throw new Error(`cycle_not_found:${args.cycleId}`);
    }

    const hypothesisText = this.extractHypothesisText(cycle.description);

    const allIssues = await this.prisma.issue.findMany({
      where: {
        cycleId: cycle.id,
        tenantId: args.tenantId,
        deletedAt: null,
      },
      select: { id: true, completedAt: true, state: { select: { category: true } } },
    });
    let completed = 0;
    let inProgress = 0;
    for (const i of allIssues) {
      const cat = i.state?.category;
      if (cat === 'completed') completed++;
      else if (cat === 'started') inProgress++;
    }
    const total = allIssues.length;
    const completedPercent = total > 0 ? Math.round((completed / total) * 100) : 0;

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * SprintAnalystService.DAY_MS);
    const twoWeeksAgo = new Date(now.getTime() - 14 * SprintAnalystService.DAY_MS);

    let closedThisWeek = 0;
    let closedPrevWeek = 0;
    for (const i of allIssues) {
      if (!i.completedAt) continue;
      const t = i.completedAt.getTime();
      if (t >= weekAgo.getTime() && t <= now.getTime()) closedThisWeek++;
      else if (t >= twoWeeksAgo.getTime() && t < weekAgo.getTime()) closedPrevWeek++;
    }
    const velocity: SprintWeeklyVelocityDto = {
      closedThisWeek,
      closedPrevWeek,
      trend:
        closedThisWeek > closedPrevWeek * 1.1
          ? 'up'
          : closedThisWeek < closedPrevWeek * 0.9
            ? 'down'
            : 'flat',
    };

    let hypothesisConfirmed: boolean | null = null;
    if (cycle.completedAt) {
      const [totalHints, resolvedHints] = await Promise.all([
        this.prisma.sprintHint.count({
          where: { cycleId: cycle.id, tenantId: args.tenantId },
        }),
        this.prisma.sprintHint.count({
          where: {
            cycleId: cycle.id,
            tenantId: args.tenantId,
            status: 'resolved',
          },
        }),
      ]);
      hypothesisConfirmed = totalHints === 0 ? null : resolvedHints / totalHints >= 0.8;
    }

    const teamHealth: SprintWeeklyTeamHealthRowDto[] = [];
    const depts = await this.prisma.department.findMany({
      where: { tenantId: args.tenantId, deletedAt: null },
      select: {
        id: true,
        name: true,
        _count: { select: { persons: true } },
      },
      take: 10,
    });
    for (const d of depts) {
      const size = d._count.persons;
      teamHealth.push({
        departmentId: d.id,
        departmentName: d.name,
        size,
        belowCohort: size < 3,
        sentiment: null,
        promises: null,
      });
    }

    const learningRows = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId: args.tenantId,
        signalType: { in: ['idea', 'knowledge_gap', 'fact'] },
        createdAt: { gte: cycle.startDate, lte: cycle.endDate },
        status: { in: ['draft', 'canonical'] },
      },
      select: {
        id: true,
        name: true,
        signalType: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    const learnings: SprintWeeklyLearningDto[] = learningRows.map((b) => ({
      ideaBlockId: b.id,
      title: b.name,
      signalType: b.signalType,
    }));

    const actionHints = await this.prisma.sprintHint.findMany({
      where: {
        cycleId: cycle.id,
        tenantId: args.tenantId,
        status: 'active',
      },
      select: { title: true },
      orderBy: { createdAt: 'desc' },
      take: 7,
    });
    const actionItems = actionHints.map((h) => h.title);
    const activeHintsCount = actionHints.length;
    const alarmCount = await this.prisma.sprintHint.count({
      where: {
        cycleId: cycle.id,
        tenantId: args.tenantId,
        status: 'active',
        OR: [{ severity: 'critical' }, { kind: 'due_date_at_risk' }],
      },
    });

    const forecast = await this.getLatestForecast(args.tenantId);

    const aiNarrative = await this.generateWeeklyNarrative({
      tenantId: args.tenantId,
      cycleName: cycle.name,
      hypothesisText,
      elapsedDays: Math.max(
        0,
        Math.round((now.getTime() - cycle.startDate.getTime()) / SprintAnalystService.DAY_MS),
      ),
      durationDays: Math.max(
        1,
        Math.round(
          (cycle.endDate.getTime() - cycle.startDate.getTime()) / SprintAnalystService.DAY_MS,
        ),
      ),
      total,
      completed,
      inProgress,
      closedThisWeek,
      closedPrevWeek,
      activeHintsCount,
      alarmCount,
      insights: learnings.map((l) => l.title),
      forecastTrend: forecast.trend,
      forecastSummary: forecast.summary,
    });

    return {
      cycleId: cycle.id,
      hypothesisText,
      hypothesisConfirmed,
      aiNarrative,
      velocity,
      teamHealth,
      outcomeMetric: { completedPercent, completed, total },
      learnings,
      actionItems,
      forecast,
      generatedAt: new Date().toISOString(),
    };
  }

  private activityColor(lastActivity: Date, now: Date): SprintActivityColor {
    const ageDays = (now.getTime() - lastActivity.getTime()) / SprintAnalystService.DAY_MS;
    if (ageDays <= 2) return 'success';
    if (ageDays < 5) return 'warning';
    return 'danger';
  }

  private extractHypothesisText(description: string | null): string | null {
    if (!description) return null;
    const trimmed = description.trim();
    if (trimmed.length === 0) return null;
    const firstParagraph = trimmed.split(/\n\n/)[0];
    return firstParagraph?.trim() ?? null;
  }

  private async resolveUserNames(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true },
    });
    const m = new Map<string, string>();
    for (const u of users) m.set(u.id, u.name);
    return m;
  }

  private async computeTopClosers(args: {
    tenantId: string;
    cycleId: string;
    from: Date;
    to: Date;
  }): Promise<SprintDailyTopCloserDto[]> {
    const closedIssues = await this.prisma.issue.findMany({
      where: {
        cycleId: args.cycleId,
        tenantId: args.tenantId,
        deletedAt: null,
        completedAt: { gte: args.from, lte: args.to },
      },
      select: {
        id: true,
        assignees: { select: { userId: true }, take: 1 },
      },
    });
    const counter = new Map<string, number>();
    for (const i of closedIssues) {
      const a = i.assignees[0]?.userId;
      if (!a) continue;
      counter.set(a, (counter.get(a) ?? 0) + 1);
    }
    const top = Array.from(counter.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    const nameMap = await this.resolveUserNames(top.map(([uid]) => uid));
    return top.map(([userId, closedCount]) => ({
      userId,
      name: nameMap.get(userId) ?? 'Сотрудник',
      closedCount,
    }));
  }

  private async computeTopHelpers(args: {
    tenantId: string;
    from: Date;
    to: Date;
  }): Promise<SprintDailyTopHelperDto[]> {
    const rows = await this.prisma.helpfulnessTrait.groupBy({
      by: ['helperUserId'],
      where: {
        tenantId: args.tenantId,
        status: 'active',
        lastObservedAt: { gte: args.from, lte: args.to },
      },
      _sum: { intensity: true },
      _count: { _all: true },
      orderBy: { _count: { helperUserId: 'desc' } },
      take: 3,
    });
    if (rows.length === 0) return [];
    const nameMap = await this.resolveUserNames(rows.map((r) => r.helperUserId));
    return rows.map((r) => ({
      userId: r.helperUserId,
      name: nameMap.get(r.helperUserId) ?? 'Сотрудник',
      helpfulnessScore: Number(r._sum.intensity ?? 0),
    }));
  }

  private async computeCarryOver(args: {
    tenantId: string;
    cycleId: string;
    issueIds: string[];
  }): Promise<number> {
    if (args.issueIds.length === 0) return 0;
    const rows = await this.prisma.issueActivity.findMany({
      where: {
        issueId: { in: args.issueIds },
        verb: { in: ['moved_from_cycle', 'cycle_changed'] },
        tenantId: args.tenantId,
      },
      select: { issueId: true },
      distinct: ['issueId'],
    });
    return rows.length;
  }

  private async getLatestForecast(tenantId: string): Promise<SprintWeeklyForecastDto> {
    const cutoff = new Date(Date.now() - 14 * SprintAnalystService.DAY_MS);
    const row = await this.prisma.forecastSnapshot.findFirst({
      where: {
        tenantId,
        scope: 'company',
        snapshotAt: { gte: cutoff },
      },
      orderBy: { snapshotAt: 'desc' },
      select: { snapshotAt: true, payloadJson: true },
    });
    if (!row) return { trend: null, summary: null, snapshotAt: null };
    const payload = row.payloadJson as {
      trend?: 'improving' | 'stable' | 'declining';
      expectedShifts?: Array<{
        metric: string;
        direction: string;
        confidence: number;
      }>;
    } | null;
    const shifts = payload?.expectedShifts ?? [];
    const summaryParts = shifts.slice(0, 3).map((s) => {
      const arrow = s.direction === 'up' ? '↑' : s.direction === 'down' ? '↓' : '→';
      return `${s.metric} ${arrow}`;
    });
    return {
      trend: payload?.trend ?? null,
      summary: summaryParts.length > 0 ? summaryParts.join(', ') : null,
      snapshotAt: row.snapshotAt.toISOString(),
    };
  }

  private async generateDailyNarrative(args: {
    tenantId: string;
    cycleName: string;
    hypothesisText: string | null;
    elapsedDays: number;
    durationDays: number;
    total: number;
    completed: number;
    inProgress: number;
    activeHintsCount: number;
    alarmCount: number;
    topRisks: string[];
    topStale: string[];
    carryOverCount: number;
  }): Promise<string | null> {
    if (!this.llm) return null;
    try {
      const result = await this.llm.call({
        taskType: 'sprint-daily-digest',
        tenantId: args.tenantId,
        systemPrompt: SPRINT_DAILY_DIGEST_SYSTEM_PROMPT,
        userMessage: buildSprintDailyDigestUserMessage(args),
        maxTokens: 700,
        sourceRef: { type: 'sprint-daily-digest', id: args.cycleName },
      });
      return result.text.trim();
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'sprint-analyst: daily LLM narrative failed',
      );
      return null;
    }
  }

  private async generateWeeklyNarrative(args: {
    tenantId: string;
    cycleName: string;
    hypothesisText: string | null;
    elapsedDays: number;
    durationDays: number;
    total: number;
    completed: number;
    inProgress: number;
    closedThisWeek: number;
    closedPrevWeek: number;
    activeHintsCount: number;
    alarmCount: number;
    insights: string[];
    forecastTrend: 'improving' | 'stable' | 'declining' | null;
    forecastSummary: string | null;
  }): Promise<string | null> {
    if (!this.llm) return null;
    try {
      const result = await this.llm.call({
        taskType: 'sprint-weekly-digest',
        tenantId: args.tenantId,
        systemPrompt: SPRINT_WEEKLY_DIGEST_SYSTEM_PROMPT,
        userMessage: buildSprintWeeklyDigestUserMessage(args),
        maxTokens: 1_000,
        sourceRef: { type: 'sprint-weekly-digest', id: args.cycleName },
      });
      return result.text.trim();
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'sprint-analyst: weekly LLM narrative failed',
      );
      return null;
    }
  }
}
