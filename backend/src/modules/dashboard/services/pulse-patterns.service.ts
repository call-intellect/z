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
  PulsePatternIrreversibleDecisionsDto,
  PulsePatternKnowledgeVelocityDto,
  PulsePatternLowRoiMeetingDto,
  PulsePatternRecurringTopicDto,
  PulsePatternsDto,
} from '../dto/pulse-patterns.dto';

/**
 * Pulse Wave 6 — единый агрегатор паттернов для главной директора
 * (`GET /api/v1/dashboard/pulse-patterns?period=week|month`).
 *
 * Источники данных — последние snapshot'ы cron'ов Волны 6 + поля Meeting и
 * Decision, проставленные event-driven воркерами. Никаких новых cron'ов и
 * никаких LLM-вызовов внутри сервиса — это чистая агрегация.
 *
 * Период:
 *   - `week` (default) — окна 7 / 30 дней в зависимости от паттерна.
 *   - `month` — окна 30 / 90 дней. Подбирается так, чтобы UI получил
 *     осмысленные данные на каждом из 7 виджетов.
 */
@Injectable()
export class PulsePatternsService {
  private readonly logger = new Logger(PulsePatternsService.name);

  /** Топ-N критических категорий для виджета Bus Factor. */
  private static readonly BUS_FACTOR_TOP = 5;
  /** Топ-N повторяющихся тем для виджета Topic Recurrence. */
  private static readonly RECURRING_TOP = 5;
  /** Топ-N встреч-болтологии. */
  private static readonly LOW_ROI_TOP = 3;
  /** Сколько отделов выводим в heatmap. */
  private static readonly BOTTLENECK_DEPT_LIMIT = 6;
  /** Топ пар в bottleneck-heatmap. */
  private static readonly BOTTLENECK_PAIRS_TOP = 5;
  /** Топ целей в Goal Vector. */
  private static readonly GOAL_TOP = 5;
  /** Топ contributors на цель. */
  private static readonly GOAL_CONTRIBUTORS_TOP = 3;
  /** Топ responders в Knowledge Velocity. */
  private static readonly RESPONDERS_TOP = 5;
  /** Сколько необратимых решений показываем. */
  private static readonly DECISIONS_TOP = 10;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getPulsePatterns(args: {
    tenantId: string;
    period: 'week' | 'month';
  }): Promise<PulsePatternsDto> {
    const periodDays = args.period === 'week' ? 7 : 30;
    const now = new Date();
    const periodStart = new Date(
      now.getTime() - periodDays * 24 * 3600 * 1000,
    );

    const [
      busFactor,
      recurringTopics,
      lowRoiMeetings,
      bottlenecks,
      goalVector,
      knowledgeVelocity,
      irreversibleDecisions,
    ] = await Promise.all([
      this.getBusFactor(args.tenantId, now),
      this.getRecurringTopics(args.tenantId, now),
      this.getLowRoiMeetings(args.tenantId, periodStart),
      this.getBottlenecks(args.tenantId, now),
      this.getGoalVector(args.tenantId, periodDays, now),
      this.getKnowledgeVelocity(args.tenantId),
      this.getIrreversibleDecisions(args.tenantId, periodStart),
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
      irreversibleDecisions,
    };
  }

  // ─── §6.1 — Bus Factor ────────────────────────────────────────────────────

  private async getBusFactor(
    tenantId: string,
    now: Date,
  ): Promise<PulsePatternBusFactorDto> {
    // Берём последний snapshot per categoryName: сортируем все snapshot'ы
    // tenant'а за 30 дней по snapshotAt DESC, потом in-memory оставляем
    // первый встретившийся per categoryName.
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

    // Сортируем: меньше всего экспертов — первее.
    criticalRows.sort((a, b) => a.expertsCount - b.expertsCount);

    return {
      critical: criticalRows.slice(0, PulsePatternsService.BUS_FACTOR_TOP),
      warningCount,
      totalCategories: latestByCategory.size,
    };
  }

  // ─── §6.2 — Topic Recurrence ─────────────────────────────────────────────

  private async getRecurringTopics(
    tenantId: string,
    now: Date,
  ): Promise<PulsePatternRecurringTopicDto> {
    // Окно — последние 14 дней snapshot'ов (cron weekly, плюс «свежесть» 7д).
    const since = new Date(now.getTime() - 14 * 24 * 3600 * 1000);
    const topics = await this.prisma.recurringTopic.findMany({
      where: { tenantId, snapshotAt: { gte: since } },
      orderBy: { mentionCount: 'desc' },
      take: PulsePatternsService.RECURRING_TOP,
      select: {
        themeId: true,
        themeName: true,
        mentionCount: true,
        meetingCount: true,
        windowStart: true,
        windowEnd: true,
      },
    });

    return {
      topics: topics.map((t) => ({
        themeId: t.themeId ?? null,
        themeName: t.themeName,
        mentionCount: t.mentionCount,
        meetingCount: t.meetingCount,
        windowDays: Math.max(
          1,
          Math.round(
            (t.windowEnd.getTime() - t.windowStart.getTime()) /
              (24 * 3600 * 1000),
          ),
        ),
      })),
    };
  }

  // ─── §6.3 — Low-ROI Meetings ─────────────────────────────────────────────

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
        durationMinutes: m.durationMs
          ? Math.max(0, Math.round(m.durationMs / 60_000))
          : 0,
        participantCount: m._count.participants,
        roiScore: m.roiScore ? Number(m.roiScore.toString()) : 0,
        startedAt: (m.startedAt ?? new Date()).toISOString(),
      })),
    };
  }

  // ─── §6.4 — Bottleneck Heatmap ───────────────────────────────────────────

  private async getBottlenecks(
    tenantId: string,
    now: Date,
  ): Promise<PulsePatternBottleneckDto> {
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
    const heatmap: number[][] = Array.from({ length: size }, () =>
      new Array<number>(size).fill(0),
    );

    for (const r of reports) {
      const severity = severityToNumber(r.severity);
      const departmentIdsInScope = r.involvedDepartmentIds.filter((id) =>
        idxById.has(id),
      );
      if (departmentIdsInScope.length === 0) continue;
      if (departmentIdsInScope.length === 1) {
        const i = idxById.get(departmentIdsInScope[0]!)!;
        heatmap[i]![i] = (heatmap[i]![i] ?? 0) + severity;
        continue;
      }
      // > 1 — раскладываем по всем парам (без двойного счёта (i,j)+(j,i)).
      for (let a = 0; a < departmentIdsInScope.length; a++) {
        for (let b = a + 1; b < departmentIdsInScope.length; b++) {
          const i = idxById.get(departmentIdsInScope[a]!)!;
          const j = idxById.get(departmentIdsInScope[b]!)!;
          heatmap[i]![j] = (heatmap[i]![j] ?? 0) + severity;
          heatmap[j]![i] = (heatmap[j]![i] ?? 0) + severity;
        }
      }
    }

    // Top pairs (без диагонали; учитываем верхний треугольник).
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

  // ─── §6.6 — Goal Vector ──────────────────────────────────────────────────

  private async getGoalVector(
    tenantId: string,
    periodDays: number,
    now: Date,
  ): Promise<PulsePatternGoalVectorDto> {
    // Берём 4 недели для week, 12 недель для month.
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
      // Главная цель ловится глобально по tenant (R4) — даже если она вне
      // топ-5 активности и потому отсутствует в `grouped`/`goals`.
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
          person: { select: { name: true, primaryDepartmentId: true } },
        },
      }),
    ]);

    // primaryGoalId: явная Goal.isPrimary, иначе fallback B-2 среди
    // загруженной выборки (max weight → min createdAt).
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

    const goalMeta = new Map(
      goals.map((g) => [g.id, { name: g.name, isPrimary: g.isPrimary }]),
    );

    // Агрегация per (goalId, personId): pro/contra/net + отдел человека.
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
      const person = c.person as
        | { name: string | null; primaryDepartmentId: string | null }
        | null;
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

    // Имена отделов — одним запросом. Собираем все НЕ-null departmentId.
    const deptIds = new Set<string>();
    for (const inner of sumByGoalPerson.values()) {
      for (const p of inner.values()) {
        if (p.departmentId) deptIds.add(p.departmentId);
      }
    }
    const deptNames = new Map<string, string>();
    if (deptIds.size > 0) {
      // Department имеет поле tenantId — фильтруем по нему (multi-tenancy).
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

      const topContributors: PulsePatternGoalContributorDto[] = [
        ...personMap.entries(),
      ]
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

      // Разрез по отделам: группируем вклады цели по departmentId.
      const byDeptAcc = new Map<
        string,
        { pro: number; contra: number; net: number }
      >();
      for (const p of personMap.values()) {
        const key = p.departmentId ?? NONE_KEY;
        const acc = byDeptAcc.get(key) ?? { pro: 0, contra: 0, net: 0 };
        acc.pro += p.pro;
        acc.contra += p.contra;
        acc.net += p.net;
        byDeptAcc.set(key, acc);
      }
      const byDepartment: PulsePatternGoalDepartmentDto[] = [
        ...byDeptAcc.entries(),
      ].map(([key, acc]) => {
        const pro = round3(acc.pro);
        const contra = round3(acc.contra);
        return {
          departmentId: key === NONE_KEY ? null : key,
          departmentName:
            key === NONE_KEY ? 'Без отдела' : (deptNames.get(key) ?? 'Без отдела'),
          proScore: pro,
          contraScore: contra,
          netScore: round3(pro - contra),
        };
      });

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

  // ─── §6.7 — Knowledge Velocity ───────────────────────────────────────────

  private async getKnowledgeVelocity(
    tenantId: string,
  ): Promise<PulsePatternKnowledgeVelocityDto> {
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
        snapshot.medianHoursToAnswer === null ||
        snapshot.medianHoursToAnswer === undefined
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

  // ─── §6.8 — Irreversible Decisions ───────────────────────────────────────

  private async getIrreversibleDecisions(
    tenantId: string,
    periodStart: Date,
  ): Promise<PulsePatternIrreversibleDecisionsDto> {
    const decisions = await this.prisma.decision.findMany({
      where: {
        tenantId,
        reversibility: 'type-1',
        createdAt: { gte: periodStart },
      },
      orderBy: { createdAt: 'desc' },
      take: PulsePatternsService.DECISIONS_TOP,
      select: {
        id: true,
        statement: true,
        text: true,
        alternatives: true,
        decidedAt: true,
        createdAt: true,
      },
    });

    let alertCount = 0;
    const out = decisions.map((d) => {
      const hasAlternatives = hasNonEmptyAlternatives(d.alternatives);
      if (!hasAlternatives) alertCount++;
      const raw = d.statement ?? d.text ?? '';
      return {
        decisionId: d.id,
        statement: raw.length > 280 ? `${raw.slice(0, 279)}…` : raw,
        decidedAt: (d.decidedAt ?? d.createdAt).toISOString(),
        hasAlternatives,
      };
    });

    return { decisions: out, alertCount };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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
  // KnowledgeVelocitySnapshot.topRespondersJson —
  // `Array<{personId, name, resolvedCount}>` (см. cron). Иногда обёрнуто в
  // объект-контейнер — поддержим оба варианта.
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
      typeof obj.resolvedCount === 'number'
        ? obj.resolvedCount
        : Number(obj.resolvedCount) || 0;
    if (name) out.push({ personName: name, resolvedCount: resolved });
  }
  return out;
}

function hasNonEmptyAlternatives(json: Prisma.JsonValue | null): boolean {
  if (!json) return false;
  if (Array.isArray(json)) return json.length > 0;
  if (typeof json === 'object') {
    const arr = (json as { items?: unknown; alternatives?: unknown }).items ??
      (json as { alternatives?: unknown }).alternatives;
    if (Array.isArray(arr)) return arr.length > 0;
  }
  return false;
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
