import { Inject, Injectable } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  DashboardLayoutResponse,
  DigestTrendResponse,
  GoalVectorByPersonResponse,
  GoalVectorPersonRow,
  IssueChainsResponse,
  IssueChainRow,
  LoadByPersonResponse,
  LoadByPersonRow,
  StuckIssuesResponse,
  StuckIssueRow,
} from '../dto/execution-dashboard.dto';

type DashboardRole = 'owner' | 'coo' | 'member';
type DashboardRhythm = 'today' | 'week' | 'month';

export interface GoalVectorPersonAggregate {
  personId: string;
  personName: string;
  netScore: number;
  proScore: number;
  contraScore: number;
  tasksDone: number;
  tasksOpen: number;
  reasons: string[];
}

export function directionFromNet(net: number): 'up' | 'side' | 'down' {
  if (net > 0.5) return 'up';
  if (net < -0.5) return 'down';
  return 'side';
}

export function buildGoalVectorRows(
  people: GoalVectorPersonAggregate[],
): GoalVectorPersonRow[] {
  return people
    .map((p) => ({
      personId: p.personId,
      personName: p.personName,
      netScore: p.netScore,
      proScore: p.proScore,
      contraScore: p.contraScore,
      tasksDone: p.tasksDone,
      tasksOpen: p.tasksOpen,
      direction: directionFromNet(p.netScore),
      reasons: p.reasons,
    }))
    .sort((a, b) => b.netScore - a.netScore);
}

type ContributionSignalKind = 'idea' | 'issue_closed' | 'goal_work';

interface ContributionSignal {
  kind: ContributionSignalKind;
  refId: string;
  direction: 'pro' | 'contra';
}

const SIGNAL_REASON_LABELS: Record<string, string> = {
  'issue_closed:pro': 'закрытые задачи',
  'goal_work:pro': 'работа по цели',
  'idea:pro': 'идеи за',
  'idea:contra': 'идеи против',
};

function extractContributionSignals(signalsJson: unknown): ContributionSignal[] {
  if (!signalsJson || typeof signalsJson !== 'object' || Array.isArray(signalsJson)) {
    return [];
  }
  const signals = (signalsJson as { signals?: unknown }).signals;
  if (!Array.isArray(signals)) return [];
  const result: ContributionSignal[] = [];
  for (const raw of signals) {
    if (!raw || typeof raw !== 'object') continue;
    const kind = (raw as { kind?: unknown }).kind;
    const direction = (raw as { direction?: unknown }).direction;
    const refId = (raw as { refId?: unknown }).refId;
    if (
      (kind === 'idea' || kind === 'issue_closed' || kind === 'goal_work') &&
      (direction === 'pro' || direction === 'contra')
    ) {
      result.push({ kind, direction, refId: typeof refId === 'string' ? refId : '' });
    }
  }
  return result;
}

export function buildGoalVectorReasons(signals: ContributionSignal[]): string[] {
  const counts = new Map<string, number>();
  for (const s of signals) {
    const composite = `${s.kind}:${s.direction}`;
    if (!(composite in SIGNAL_REASON_LABELS)) continue;
    counts.set(composite, (counts.get(composite) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([composite, count]) => `${SIGNAL_REASON_LABELS[composite]!} ×${count}`);
}

export function computeDeltas(
  current: Record<string, unknown> | null,
  previous: Record<string, unknown> | null,
): Record<string, number> {
  const deltas: Record<string, number> = {};
  if (!current || !previous) return deltas;
  for (const key of Object.keys(current)) {
    const cur = current[key];
    const prev = previous[key];
    if (typeof cur === 'number' && typeof prev === 'number') {
      deltas[key] = cur - prev;
    }
  }
  return deltas;
}

const SHARE_METRIC_SUFFIX = 'Share';

export function aggregateWeeklyMetrics(
  metricsList: Record<string, unknown>[],
): Record<string, number> {
  if (metricsList.length === 0) return {};
  const sums = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const metrics of metricsList) {
    for (const [key, value] of Object.entries(metrics)) {
      if (typeof value !== 'number' || Number.isNaN(value)) continue;
      sums.set(key, (sums.get(key) ?? 0) + value);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const result: Record<string, number> = {};
  for (const [key, sum] of sums) {
    if (key.endsWith(SHARE_METRIC_SUFFIX)) {
      const count = counts.get(key) ?? 1;
      result[key] = sum / count;
    } else {
      result[key] = sum;
    }
  }
  return result;
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function startOfIsoWeekUtc(now: Date): Date {
  const day = startOfUtcDay(now);
  const dow = day.getUTCDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  return new Date(day.getTime() + diff * 24 * 3_600_000);
}

function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function addUtcMonths(now: Date, months: number): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, 1));
}

@Injectable()
export class ExecutionDashboardService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async getLayout(args: {
    role: DashboardRole;
    rhythm: DashboardRhythm;
  }): Promise<DashboardLayoutResponse> {
    const { role, rhythm } = args;
    const layout = await this.cfg.getDynamic<string[] | null>(
      `dashboard.preset.${role}.${rhythm}`,
      undefined,
      null,
    );
    const valid =
      Array.isArray(layout) && layout.every((item) => typeof item === 'string') ? layout : null;
    return { role, rhythm, layout: valid };
  }

  async getGoalVectorByPerson(args: {
    tenantId: string;
    goalId?: string;
    period: 'day' | 'week' | 'month';
    now: Date;
  }): Promise<GoalVectorByPersonResponse> {
    const { tenantId, period, now } = args;

    const goalId = await this.resolveGoalId(tenantId, args.goalId);
    if (!goalId) {
      return { goalId: null, goalTitle: null, rows: [], goalState: 'none' };
    }

    const goal = await this.prisma.goal.findFirst({
      where: { tenantId, id: goalId },
      select: { id: true, name: true, isPrimary: true },
    });
    const goalTitle = goal?.name ?? null;
    const goalState: 'primary' | 'active_fallback' | 'none' = goal?.isPrimary
      ? 'primary'
      : 'active_fallback';

    const contribSince =
      period === 'month'
        ? new Date(now.getTime() - 28 * 24 * 3_600_000)
        : startOfIsoWeekUtc(now);

    const contributions = await this.prisma.personGoalContribution.findMany({
      where: { tenantId, goalId, weekStart: { gte: contribSince } },
      select: {
        personId: true,
        proScore: true,
        contraScore: true,
        netScore: true,
        signalsJson: true,
      },
    });

    const byPerson = new Map<
      string,
      { proScore: number; contraScore: number; netScore: number }
    >();
    const signalsByPerson = new Map<string, ContributionSignal[]>();
    for (const c of contributions) {
      const prev = byPerson.get(c.personId) ?? { proScore: 0, contraScore: 0, netScore: 0 };
      prev.proScore += Number(c.proScore.toString());
      prev.contraScore += Number(c.contraScore.toString());
      prev.netScore += Number(c.netScore.toString());
      byPerson.set(c.personId, prev);

      const signals = extractContributionSignals(c.signalsJson);
      if (signals.length > 0) {
        const acc = signalsByPerson.get(c.personId) ?? [];
        acc.push(...signals);
        signalsByPerson.set(c.personId, acc);
      }
    }

    const assignees = await this.prisma.issueAssignee.findMany({
      where: { issue: { tenantId, goalId } },
      select: { userId: true },
    });
    const assigneeUserIds = [...new Set(assignees.map((a) => a.userId))];

    const personsByUserId = new Map<string, { id: string; name: string }>();
    if (assigneeUserIds.length > 0) {
      const persons = await this.prisma.person.findMany({
        where: { tenantId, userId: { in: assigneeUserIds } },
        select: { id: true, name: true, userId: true },
      });
      for (const p of persons) {
        if (p.userId) personsByUserId.set(p.userId, { id: p.id, name: p.name });
      }
    }

    const personIds = new Set<string>(byPerson.keys());
    for (const p of personsByUserId.values()) personIds.add(p.id);
    if (personIds.size === 0) {
      return { goalId, goalTitle, rows: [], goalState };
    }

    const personMeta = await this.prisma.person.findMany({
      where: { tenantId, id: { in: [...personIds] } },
      select: { id: true, name: true, userId: true },
    });
    const nameByPersonId = new Map<string, string>();
    const userIdByPersonId = new Map<string, string | null>();
    for (const p of personMeta) {
      nameByPersonId.set(p.id, p.name);
      userIdByPersonId.set(p.id, p.userId);
    }

    const doneSince =
      period === 'day'
        ? startOfUtcDay(now)
        : period === 'week'
          ? startOfIsoWeekUtc(now)
          : new Date(now.getTime() - 28 * 24 * 3_600_000);

    const tasksByUserId = new Map<string, { open: number; done: number }>();
    if (assigneeUserIds.length > 0) {
      const [openAssignees, doneAssignees] = await Promise.all([
        this.prisma.issueAssignee.findMany({
          where: { issue: { tenantId, goalId, completedAt: null } },
          select: { userId: true },
        }),
        this.prisma.issueAssignee.findMany({
          where: { issue: { tenantId, goalId, completedAt: { gte: doneSince } } },
          select: { userId: true },
        }),
      ]);
      for (const a of openAssignees) {
        const prev = tasksByUserId.get(a.userId) ?? { open: 0, done: 0 };
        prev.open += 1;
        tasksByUserId.set(a.userId, prev);
      }
      for (const a of doneAssignees) {
        const prev = tasksByUserId.get(a.userId) ?? { open: 0, done: 0 };
        prev.done += 1;
        tasksByUserId.set(a.userId, prev);
      }
    }

    const aggregates: GoalVectorPersonAggregate[] = [];
    for (const personId of personIds) {
      const contrib = byPerson.get(personId) ?? { proScore: 0, contraScore: 0, netScore: 0 };
      const userId = userIdByPersonId.get(personId) ?? null;
      const tasks = userId ? (tasksByUserId.get(userId) ?? { open: 0, done: 0 }) : { open: 0, done: 0 };
      aggregates.push({
        personId,
        personName: nameByPersonId.get(personId) ?? 'Без имени',
        netScore: contrib.netScore,
        proScore: contrib.proScore,
        contraScore: contrib.contraScore,
        tasksDone: tasks.done,
        tasksOpen: tasks.open,
        reasons: buildGoalVectorReasons(signalsByPerson.get(personId) ?? []),
      });
    }

    return { goalId, goalTitle, rows: buildGoalVectorRows(aggregates), goalState };
  }

  private async resolveGoalId(tenantId: string, requested?: string): Promise<string | null> {
    if (requested) return requested;
    const primary = await this.prisma.goal.findFirst({
      where: { tenantId, isPrimary: true },
      select: { id: true },
    });
    if (primary) return primary.id;
    const top = await this.prisma.personGoalContribution.groupBy({
      by: ['goalId'],
      where: { tenantId },
      _sum: { netScore: true },
      orderBy: { _sum: { netScore: 'desc' } },
      take: 1,
    });
    if (top[0]?.goalId) return top[0].goalId;
    const active = await this.prisma.goal.findFirst({
      where: { tenantId, status: 'active' },
      orderBy: [{ isPrimary: 'desc' }, { weight: 'desc' }, { createdAt: 'asc' }],
      select: { id: true },
    });
    return active?.id ?? null;
  }

  async getIssueChains(args: {
    tenantId: string;
    limit: number;
  }): Promise<IssueChainsResponse> {
    const { tenantId, limit } = args;
    const relations = await this.prisma.issueRelation.findMany({
      where: {
        relationType: { in: ['blocks', 'blocked_by'] },
        source: { tenantId },
        target: { completedAt: null },
      },
      select: {
        relationType: true,
        source: { select: { id: true, identifier: true, title: true } },
        target: { select: { id: true, identifier: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const chains: IssueChainRow[] = relations.map((r) => ({
      sourceIssueId: r.source.id,
      sourceIdentifier: r.source.identifier,
      sourceTitle: r.source.title,
      targetIssueId: r.target.id,
      targetIdentifier: r.target.identifier,
      targetTitle: r.target.title,
      relationType: r.relationType as 'blocks' | 'blocked_by',
    }));
    return { chains };
  }

  async getStuckCrossProject(args: {
    tenantId: string;
    now: Date;
  }): Promise<StuckIssuesResponse> {
    const { tenantId, now } = args;
    const staleDays = await this.cfg.getDynamic<number>(
      'dashboard.stuck.staleDaysThreshold',
      undefined,
      5,
    );
    const cutoff = new Date(now.getTime() - staleDays * 86_400_000);

    const issues = await this.prisma.issue.findMany({
      where: {
        tenantId,
        deletedAt: null,
        archivedAt: null,
        state: { is: { category: { notIn: ['completed', 'cancelled'] } } },
      },
      select: {
        id: true,
        identifier: true,
        title: true,
        createdAt: true,
        dueDate: true,
        projectId: true,
        project: { select: { name: true } },
        assignees: {
          select: { userId: true, assignedAt: true },
          orderBy: { assignedAt: 'asc' },
          take: 1,
        },
      },
      take: 500,
    });
    if (issues.length === 0) {
      return { items: [], staleDaysThreshold: staleDays };
    }

    const issueIds = issues.map((i) => i.id);
    const lastActivity = await this.prisma.issueActivity.groupBy({
      by: ['issueId'],
      where: { issueId: { in: issueIds } },
      _max: { createdAt: true },
    });
    const lastMovementByIssue = new Map<string, Date>();
    for (const row of lastActivity) {
      if (row._max.createdAt) lastMovementByIssue.set(row.issueId, row._max.createdAt);
    }

    const assigneeUserIds = Array.from(
      new Set(
        issues
          .map((i) => i.assignees[0]?.userId)
          .filter((id): id is string => typeof id === 'string'),
      ),
    );
    const nameByUserId = new Map<string, string>();
    if (assigneeUserIds.length > 0) {
      const persons = await this.prisma.person.findMany({
        where: { tenantId, userId: { in: assigneeUserIds }, deletedAt: null },
        select: { name: true, userId: true },
      });
      for (const p of persons) {
        if (p.userId) nameByUserId.set(p.userId, p.name);
      }
    }

    const day = 86_400_000;
    const items: StuckIssueRow[] = [];
    for (const issue of issues) {
      const lastMovement = lastMovementByIssue.get(issue.id) ?? issue.createdAt;
      if (lastMovement.getTime() >= cutoff.getTime()) continue;
      const assigneeUserId = issue.assignees[0]?.userId ?? null;
      items.push({
        issueId: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        projectId: issue.projectId,
        projectName: issue.project?.name ?? 'Без проекта',
        daysStuck: Math.floor((now.getTime() - lastMovement.getTime()) / day),
        assigneeUserId,
        assigneeName: assigneeUserId ? (nameByUserId.get(assigneeUserId) ?? null) : null,
        dueDate: issue.dueDate ? issue.dueDate.toISOString() : null,
      });
    }

    items.sort((a, b) => b.daysStuck - a.daysStuck);
    return { items: items.slice(0, 50), staleDaysThreshold: staleDays };
  }

  async getLoadByPerson(args: { tenantId: string }): Promise<LoadByPersonResponse> {
    const { tenantId } = args;
    const [overloadThreshold, idleThreshold] = await Promise.all([
      this.cfg.getDynamic<number>('dashboard.load.overload_threshold', undefined, 8),
      this.cfg.getDynamic<number>('dashboard.load.idle_threshold', undefined, 2),
    ]);

    const grouped = await this.prisma.issueAssignee.groupBy({
      by: ['userId'],
      where: { issue: { tenantId, completedAt: null } },
      _count: { _all: true },
    });
    if (grouped.length === 0) return { rows: [] };

    const userIds = grouped.map((g) => g.userId);
    const persons = await this.prisma.person.findMany({
      where: { tenantId, userId: { in: userIds } },
      select: { name: true, userId: true },
    });
    const nameByUserId = new Map<string, string>();
    for (const p of persons) {
      if (p.userId) nameByUserId.set(p.userId, p.name);
    }

    const rows: LoadByPersonRow[] = grouped
      .map((g) => {
        const activeTasks = g._count._all;
        const level: 'overload' | 'normal' | 'idle' =
          activeTasks > overloadThreshold
            ? 'overload'
            : activeTasks <= idleThreshold
              ? 'idle'
              : 'normal';
        return {
          userId: g.userId,
          personName: nameByUserId.get(g.userId) ?? 'Без имени',
          activeTasks,
          level,
        };
      })
      .sort((a, b) => b.activeTasks - a.activeTasks);
    return { rows };
  }

  async getOperationsTrend(args: {
    period: 'day' | 'week' | 'month';
    tenantId: string;
    now: Date;
  }): Promise<DigestTrendResponse> {
    const { period, tenantId, now } = args;
    const { current, previous } =
      period === 'day'
        ? await this.fetchDailyTrend(tenantId, now)
        : period === 'month'
          ? await this.fetchMonthlyTrend(tenantId, now)
          : await this.fetchWeeklyTrend(tenantId, now);
    return { period, current, previous, deltas: computeDeltas(current, previous) };
  }

  private async fetchMonthlyTrend(
    tenantId: string,
    now: Date,
  ): Promise<{
    current: Record<string, unknown> | null;
    previous: Record<string, unknown> | null;
  }> {
    const curStart = startOfUtcMonth(now);
    const curEnd = startOfUtcMonth(addUtcMonths(now, 1));
    const prevStart = startOfUtcMonth(addUtcMonths(now, -1));
    const toLocal = (d: Date): string => d.toISOString().slice(0, 10);

    const [curDigests, prevDigests] = await Promise.all([
      this.prisma.weeklyOperationsDigest.findMany({
        where: {
          tenantId,
          weekStart: { gte: toLocal(curStart), lt: toLocal(curEnd) },
        },
        select: { metricsJson: true },
      }),
      this.prisma.weeklyOperationsDigest.findMany({
        where: {
          tenantId,
          weekStart: { gte: toLocal(prevStart), lt: toLocal(curStart) },
        },
        select: { metricsJson: true },
      }),
    ]);

    const curList = curDigests
      .map((d) => toMetricsRecord(d.metricsJson))
      .filter((m): m is Record<string, unknown> => m !== null);
    const prevList = prevDigests
      .map((d) => toMetricsRecord(d.metricsJson))
      .filter((m): m is Record<string, unknown> => m !== null);

    return {
      current: curList.length > 0 ? aggregateWeeklyMetrics(curList) : null,
      previous: prevList.length > 0 ? aggregateWeeklyMetrics(prevList) : null,
    };
  }

  private async fetchDailyTrend(
    tenantId: string,
    now: Date,
  ): Promise<{
    current: Record<string, unknown> | null;
    previous: Record<string, unknown> | null;
  }> {
    const todayLocal = startOfUtcDay(now).toISOString().slice(0, 10);
    const prevLocal = new Date(startOfUtcDay(now).getTime() - 24 * 3_600_000)
      .toISOString()
      .slice(0, 10);
    const [cur, prev] = await Promise.all([
      this.prisma.dailyOperationsDigest.findUnique({
        where: { tenantId_dateLocal: { tenantId, dateLocal: todayLocal } },
        select: { metricsJson: true },
      }),
      this.prisma.dailyOperationsDigest.findUnique({
        where: { tenantId_dateLocal: { tenantId, dateLocal: prevLocal } },
        select: { metricsJson: true },
      }),
    ]);
    return { current: toMetricsRecord(cur?.metricsJson), previous: toMetricsRecord(prev?.metricsJson) };
  }

  private async fetchWeeklyTrend(
    tenantId: string,
    now: Date,
  ): Promise<{
    current: Record<string, unknown> | null;
    previous: Record<string, unknown> | null;
  }> {
    const weekStart = startOfIsoWeekUtc(now).toISOString().slice(0, 10);
    const prevWeekStart = new Date(startOfIsoWeekUtc(now).getTime() - 7 * 24 * 3_600_000)
      .toISOString()
      .slice(0, 10);
    const [cur, prev] = await Promise.all([
      this.prisma.weeklyOperationsDigest.findUnique({
        where: { tenantId_weekStart: { tenantId, weekStart } },
        select: { metricsJson: true },
      }),
      this.prisma.weeklyOperationsDigest.findUnique({
        where: { tenantId_weekStart: { tenantId, weekStart: prevWeekStart } },
        select: { metricsJson: true },
      }),
    ]);
    return { current: toMetricsRecord(cur?.metricsJson), previous: toMetricsRecord(prev?.metricsJson) };
  }
}

function toMetricsRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}
