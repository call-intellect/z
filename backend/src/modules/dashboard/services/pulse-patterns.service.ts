import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { PRESENT_PARTICIPANT_WHERE } from '../../participants/participant-presence';
import type {
  PulsePatternBottleneckDto,
  PulsePatternBottleneckTopPairDto,
  PulsePatternBusFactorDto,
  PulsePatternGoalContributorDto,
  PulsePatternGoalDepartmentDto,
  PulsePatternGoalVectorDto,
  PulsePatternGoalVectorItemDto,
  PulsePatternKnowledgeVelocityDto,
  PulsePatternLowRoiMeetingDto,
  PulsePatternRecurringTopicDto,
  PulsePatternsDto,
} from '../dto/pulse-patterns.dto';

export function dedupeLatestRecurringTopicByTheme<
  T extends { themeId: string | null; themeName: string; snapshotAt: Date },
>(rows: T[]): T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const key = row.themeId ?? `name:${row.themeName}`;
    const prev = latest.get(key);
    if (!prev || row.snapshotAt.getTime() > prev.snapshotAt.getTime()) {
      latest.set(key, row);
    }
  }
  return [...latest.values()];
}

@Injectable()
export class PulsePatternsService {
  private readonly logger = new Logger(PulsePatternsService.name);

  private static readonly BUS_FACTOR_TOP = 5;
  private static readonly RECURRING_TOP = 5;
  private static readonly LOW_ROI_TOP = 3;
  private static readonly BOTTLENECK_DEPT_LIMIT = 6;
  private static readonly BOTTLENECK_PAIRS_TOP = 5;
  private static readonly GOAL_TOP = 5;
  private static readonly GOAL_CONTRIBUTORS_TOP = 3;
  private static readonly RESPONDERS_TOP = 5;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getPulsePatterns(args: {
    tenantId: string;
    period: 'week' | 'month';
  }): Promise<PulsePatternsDto> {
    const periodDays = args.period === 'week' ? 7 : 30;
    const now = new Date();
    const periodStart = new Date(now.getTime() - periodDays * 24 * 3600 * 1000);

    const [
      busFactor,
      recurringTopics,
      lowRoiMeetings,
      bottlenecks,
      goalVector,
      knowledgeVelocity,
    ] = await Promise.all([
      this.getBusFactor(args.tenantId, now),
      this.getRecurringTopics(args.tenantId, now),
      this.getLowRoiMeetings(args.tenantId, periodStart),
      this.getBottlenecks(args.tenantId, now),
      this.getGoalVector(args.tenantId, periodDays, now),
      this.getKnowledgeVelocity(args.tenantId),
    ]);

    return {
      period: args.period,
      generatedAt: now.toISOString(),
      busFactor,
      recurringTopics,
      lowRoiMeetings,
      bottlenecks,
      goalVector,
      knowledgeVelocity,
    };
  }

  private async getBusFactor(tenantId: string, now: Date): Promise<PulsePatternBusFactorDto> {
    const lookbackStart = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    const snapshots = await this.prisma.knowledgeRiskSnapshot.findMany({
      where: {
        tenantId,
        snapshotAt: { gte: lookbackStart },
      },
      orderBy: { snapshotAt: 'desc' },
      take: 1_000,
      select: {
        categoryName: true,
        riskLevel: true,
        highConfidenceCount: true,
        topExpertsJson: true,
        snapshotAt: true,
      },
    });

    const latestByCategory = new Map<
      string,
      {
        categoryName: string;
        riskLevel: string;
        highConfidenceCount: number;
        topExpertsJson: Prisma.JsonValue;
      }
    >();
    for (const s of snapshots) {
      if (!latestByCategory.has(s.categoryName)) {
        latestByCategory.set(s.categoryName, s);
      }
    }

    let warningCount = 0;
    const criticalRows: Array<{
      categoryName: string;
      expertsCount: number;
      topExperts: string[];
    }> = [];

    for (const s of latestByCategory.values()) {
      if (s.riskLevel === 'warning') warningCount++;
      if (s.riskLevel === 'critical') {
        criticalRows.push({
          categoryName: s.categoryName,
          expertsCount: s.highConfidenceCount,
          topExperts: parseTopExperts(s.topExpertsJson),
        });
      }
    }

    criticalRows.sort((a, b) => a.expertsCount - b.expertsCount);

    return {
      critical: criticalRows.slice(0, PulsePatternsService.BUS_FACTOR_TOP),
      warningCount,
      totalCategories: latestByCategory.size,
    };
  }

  private async getRecurringTopics(
    tenantId: string,
    now: Date,
  ): Promise<PulsePatternRecurringTopicDto> {
    const since = new Date(now.getTime() - 14 * 24 * 3600 * 1000);
    const rawTopics = await this.prisma.recurringTopic.findMany({
      where: { tenantId, snapshotAt: { gte: since } },
      orderBy: { snapshotAt: 'desc' },
      select: {
        themeId: true,
        themeName: true,
        mentionCount: true,
        meetingCount: true,
        windowStart: true,
        windowEnd: true,
        snapshotAt: true,
      },
    });
    const topics = dedupeLatestRecurringTopicByTheme(rawTopics)
      .sort((a, b) => b.mentionCount - a.mentionCount)
      .slice(0, PulsePatternsService.RECURRING_TOP);

    return {
      topics: topics.map((t) => ({
        themeId: t.themeId ?? null,
        themeName: t.themeName,
        mentionCount: t.mentionCount,
        meetingCount: t.meetingCount,
        windowDays: Math.max(
          1,
          Math.round((t.windowEnd.getTime() - t.windowStart.getTime()) / (24 * 3600 * 1000)),
        ),
      })),
    };
  }

  private async getLowRoiMeetings(
    tenantId: string,
    periodStart: Date,
  ): Promise<PulsePatternLowRoiMeetingDto> {
    const meetings = await this.prisma.meeting.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: 'completed',
        roiScore: { not: null },
        startedAt: { gte: periodStart, not: null },
      },
      orderBy: { roiScore: 'asc' },
      take: PulsePatternsService.LOW_ROI_TOP,
      select: {
        id: true,
        title: true,
        startedAt: true,
        durationMs: true,
        roiScore: true,
        _count: { select: { participants: { where: PRESENT_PARTICIPANT_WHERE } } },
      },
    });

    return {
      meetings: meetings.map((m) => ({
        meetingId: m.id,
        title: m.title,
        durationMinutes: m.durationMs ? Math.max(0, Math.round(m.durationMs / 60_000)) : 0,
        participantCount: m._count.participants,
        roiScore: m.roiScore ? Number(m.roiScore.toString()) : 0,
        startedAt: (m.startedAt ?? new Date()).toISOString(),
      })),
    };
  }

  private async getBottlenecks(tenantId: string, now: Date): Promise<PulsePatternBottleneckDto> {
    const since = new Date(now.getTime() - 30 * 24 * 3600 * 1000);

    const [reports, departments] = await Promise.all([
      this.prisma.crossFunctionalFrictionReport.findMany({
        where: {
          tenantId,
          createdAt: { gte: since },
        },
        select: {
          severity: true,
          involvedDepartmentIds: true,
        },
        take: 2_000,
      }),
      this.prisma.department.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        take: PulsePatternsService.BOTTLENECK_DEPT_LIMIT,
        select: { id: true, name: true },
      }),
    ]);

    if (departments.length === 0) {
      return { heatmap: [], departments: [], topPairs: [] };
    }

    const idxById = new Map<string, number>();
    departments.forEach((d, i) => idxById.set(d.id, i));

    const size = departments.length;
    const heatmap: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0));

    for (const r of reports) {
      const severity = severityToNumber(r.severity);
      const departmentIdsInScope = r.involvedDepartmentIds.filter((id) => idxById.has(id));
      if (departmentIdsInScope.length === 0) continue;
      if (departmentIdsInScope.length === 1) {
        const i = idxById.get(departmentIdsInScope[0]!)!;
        heatmap[i]![i] = (heatmap[i]![i] ?? 0) + severity;
        continue;
      }
      for (let a = 0; a < departmentIdsInScope.length; a++) {
        for (let b = a + 1; b < departmentIdsInScope.length; b++) {
          const i = idxById.get(departmentIdsInScope[a]!)!;
          const j = idxById.get(departmentIdsInScope[b]!)!;
          heatmap[i]![j] = (heatmap[i]![j] ?? 0) + severity;
          heatmap[j]![i] = (heatmap[j]![i] ?? 0) + severity;
        }
      }
    }

    const pairs: PulsePatternBottleneckTopPairDto[] = [];
    for (let i = 0; i < size; i++) {
      for (let j = i + 1; j < size; j++) {
        const v = heatmap[i]![j] ?? 0;
        if (v > 0) {
          pairs.push({
            fromName: departments[i]!.name,
            toName: departments[j]!.name,
            severity: v,
          });
        }
      }
    }
    pairs.sort((a, b) => b.severity - a.severity);

    return {
      heatmap,
      departments: departments.map((d) => ({ id: d.id, name: d.name })),
      topPairs: pairs.slice(0, PulsePatternsService.BOTTLENECK_PAIRS_TOP),
    };
  }

  private async getGoalVector(
    tenantId: string,
    periodDays: number,
    now: Date,
  ): Promise<PulsePatternGoalVectorDto> {
    const weeksBack = periodDays === 7 ? 4 : 12;
    const since = new Date(now.getTime() - weeksBack * 7 * 24 * 3600 * 1000);

    const grouped = await this.prisma.personGoalContribution.groupBy({
      by: ['goalId'],
      where: { tenantId, weekStart: { gte: since } },
      _sum: { netScore: true, proScore: true, contraScore: true },
      orderBy: { _sum: { netScore: 'desc' } },
      take: PulsePatternsService.GOAL_TOP,
    });

    if (grouped.length === 0) {
      return { goals: [], primaryGoalId: null };
    }

    const goalIds = grouped.map((g) => g.goalId);

    const [primary, goals, contributions] = await Promise.all([
      this.prisma.goal.findFirst({
        where: { tenantId, isPrimary: true },
        select: { id: true },
      }),
      this.prisma.goal.findMany({
        where: { tenantId, id: { in: goalIds } },
        select: {
          id: true,
          name: true,
          isPrimary: true,
          weight: true,
          createdAt: true,
        },
      }),
      this.prisma.personGoalContribution.findMany({
        where: {
          tenantId,
          goalId: { in: goalIds },
          weekStart: { gte: since },
        },
        select: {
          goalId: true,
          personId: true,
          proScore: true,
          contraScore: true,
          netScore: true,
        },
      }),
    ]);

    const personIds = new Set(contributions.map((c) => c.personId));
    const personMeta = new Map<
      string,
      { name: string | null; primaryDepartmentId: string | null }
    >();
    if (personIds.size > 0) {
      const persons = await this.prisma.person.findMany({
        where: { tenantId, id: { in: [...personIds] } },
        select: { id: true, name: true, primaryDepartmentId: true },
      });
      for (const p of persons) {
        personMeta.set(p.id, {
          name: p.name,
          primaryDepartmentId: p.primaryDepartmentId,
        });
      }
    }

    let primaryGoalId: string | null;
    if (primary) {
      primaryGoalId = primary.id;
    } else {
      const sortedFallback = [...goals].sort((a, b) => {
        const byWeight = Number(b.weight) - Number(a.weight);
        if (byWeight !== 0) return byWeight;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });
      primaryGoalId = sortedFallback[0]?.id ?? null;
    }

    const goalMeta = new Map(goals.map((g) => [g.id, { name: g.name, isPrimary: g.isPrimary }]));

    const sumByGoalPerson = new Map<
      string,
      Map<
        string,
        {
          name: string;
          departmentId: string | null;
          pro: number;
          contra: number;
          net: number;
        }
      >
    >();
    for (const c of contributions) {
      const inner =
        sumByGoalPerson.get(c.goalId) ??
        new Map<
          string,
          {
            name: string;
            departmentId: string | null;
            pro: number;
            contra: number;
            net: number;
          }
        >();
      const person = personMeta.get(c.personId) ?? null;
      const prev = inner.get(c.personId) ?? {
        name: person?.name ?? 'Без имени',
        departmentId: person?.primaryDepartmentId ?? null,
        pro: 0,
        contra: 0,
        net: 0,
      };
      prev.pro += Number(c.proScore.toString());
      prev.contra += Number(c.contraScore.toString());
      prev.net += Number(c.netScore.toString());
      inner.set(c.personId, prev);
      sumByGoalPerson.set(c.goalId, inner);
    }

    const deptIds = new Set<string>();
    for (const inner of sumByGoalPerson.values()) {
      for (const p of inner.values()) {
        if (p.departmentId) deptIds.add(p.departmentId);
      }
    }
    const deptNames = new Map<string, string>();
    if (deptIds.size > 0) {
      const depts = await this.prisma.department.findMany({
        where: { tenantId, id: { in: [...deptIds] } },
        select: { id: true, name: true },
      });
      for (const d of depts) deptNames.set(d.id, d.name);
    }

    const NONE_KEY = '__none__';

    const goalsOut: PulsePatternGoalVectorItemDto[] = grouped.map((g) => {
      const personMap =
        sumByGoalPerson.get(g.goalId) ??
        new Map<
          string,
          {
            name: string;
            departmentId: string | null;
            pro: number;
            contra: number;
            net: number;
          }
        >();

      const topContributors: PulsePatternGoalContributorDto[] = [...personMap.entries()]
        .sort((a, b) => Math.abs(b[1].net) - Math.abs(a[1].net))
        .slice(0, PulsePatternsService.GOAL_CONTRIBUTORS_TOP)
        .map(([personId, p]) => {
          const pro = round3(p.pro);
          const contra = round3(p.contra);
          return {
            personId,
            personName: p.name,
            proScore: pro,
            contraScore: contra,
            netScore: round3(pro - contra),
          };
        });

      const byDeptAcc = new Map<string, { pro: number; contra: number; net: number }>();
      for (const p of personMap.values()) {
        const key = p.departmentId ?? NONE_KEY;
        const acc = byDeptAcc.get(key) ?? { pro: 0, contra: 0, net: 0 };
        acc.pro += p.pro;
        acc.contra += p.contra;
        acc.net += p.net;
        byDeptAcc.set(key, acc);
      }
      const byDepartment: PulsePatternGoalDepartmentDto[] = [...byDeptAcc.entries()].map(
        ([key, acc]) => {
          const pro = round3(acc.pro);
          const contra = round3(acc.contra);
          return {
            departmentId: key === NONE_KEY ? null : key,
            departmentName: key === NONE_KEY ? 'Без отдела' : (deptNames.get(key) ?? 'Без отдела'),
            proScore: pro,
            contraScore: contra,
            netScore: round3(pro - contra),
          };
        },
      );

      const meta = goalMeta.get(g.goalId);
      const proSum = round3(Number(g._sum.proScore?.toString() ?? '0'));
      const contraSum = round3(Number(g._sum.contraScore?.toString() ?? '0'));
      return {
        goalId: g.goalId,
        goalTitle: meta?.name ?? 'Без названия',
        isPrimary: meta?.isPrimary ?? false,
        proScore: proSum,
        contraScore: contraSum,
        netScore: round3(proSum - contraSum),
        topContributors,
        byDepartment,
      };
    });

    return { goals: goalsOut, primaryGoalId };
  }

  private async getKnowledgeVelocity(tenantId: string): Promise<PulsePatternKnowledgeVelocityDto> {
    const snapshot = await this.prisma.knowledgeVelocitySnapshot.findFirst({
      where: { tenantId },
      orderBy: { snapshotAt: 'desc' },
      select: {
        medianHoursToAnswer: true,
        resolvedGapsCount: true,
        openGapsCount: true,
        topRespondersJson: true,
      },
    });

    if (!snapshot) {
      return {
        medianHours: null,
        resolvedGapsCount: 0,
        openGapsCount: 0,
        topResponders: [],
      };
    }

    return {
      medianHours:
        snapshot.medianHoursToAnswer === null || snapshot.medianHoursToAnswer === undefined
          ? null
          : Number(snapshot.medianHoursToAnswer.toString()),
      resolvedGapsCount: snapshot.resolvedGapsCount,
      openGapsCount: snapshot.openGapsCount,
      topResponders: parseTopResponders(snapshot.topRespondersJson).slice(
        0,
        PulsePatternsService.RESPONDERS_TOP,
      ),
    };
  }
}

function parseTopExperts(json: Prisma.JsonValue): string[] {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return [];
  const experts = (json as { experts?: unknown }).experts;
  if (!Array.isArray(experts)) return [];
  const names: string[] = [];
  for (const e of experts) {
    if (e && typeof e === 'object' && 'name' in e) {
      const name = (e as { name?: unknown }).name;
      if (typeof name === 'string' && name.length > 0) names.push(name);
    }
  }
  return names;
}

function parseTopResponders(
  json: Prisma.JsonValue,
): Array<{ personName: string; resolvedCount: number }> {
  let list: unknown = json;
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const inner = (json as { responders?: unknown }).responders;
    if (Array.isArray(inner)) list = inner;
  }
  if (!Array.isArray(list)) return [];
  const out: Array<{ personName: string; resolvedCount: number }> = [];
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const obj = e as { name?: unknown; resolvedCount?: unknown };
    const name = typeof obj.name === 'string' ? obj.name : null;
    const resolved =
      typeof obj.resolvedCount === 'number' ? obj.resolvedCount : Number(obj.resolvedCount) || 0;
    if (name) out.push({ personName: name, resolvedCount: resolved });
  }
  return out;
}

function severityToNumber(severity: string): number {
  switch (severity) {
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
      return 1;
    default:
      return 1;
  }
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
