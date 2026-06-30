import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import {
  dedupeLatestRecurringTopicByTheme,
  PulsePatternsService,
} from './pulse-patterns.service';

function buildService(overrides: Partial<Record<string, unknown>> = {}): {
  service: PulsePatternsService;
  mocks: Record<string, ReturnType<typeof vi.fn>>;
} {
  const mocks = {
    knowledgeRiskSnapshotFindMany: vi.fn(async () => []),
    recurringTopicFindMany: vi.fn(async () => []),
    meetingFindMany: vi.fn(async () => []),
    crossFunctionalFrictionFindMany: vi.fn(async () => []),
    departmentFindMany: vi.fn(async () => []),
    personGoalContributionGroupBy: vi.fn(async () => []),
    personGoalContributionFindMany: vi.fn(async () => []),
    personFindMany: vi.fn(async () => []),
    goalFindMany: vi.fn(async () => []),
    goalFindFirst: vi.fn(async () => null),
    knowledgeVelocitySnapshotFindFirst: vi.fn(async () => null),
    decisionFindMany: vi.fn(async () => []),
    ...overrides,
  };

  const prisma = {
    knowledgeRiskSnapshot: { findMany: mocks.knowledgeRiskSnapshotFindMany },
    recurringTopic: { findMany: mocks.recurringTopicFindMany },
    meeting: { findMany: mocks.meetingFindMany },
    crossFunctionalFrictionReport: {
      findMany: mocks.crossFunctionalFrictionFindMany,
    },
    department: { findMany: mocks.departmentFindMany },
    person: { findMany: mocks.personFindMany },
    personGoalContribution: {
      groupBy: mocks.personGoalContributionGroupBy,
      findMany: mocks.personGoalContributionFindMany,
    },
    goal: { findMany: mocks.goalFindMany, findFirst: mocks.goalFindFirst },
    knowledgeVelocitySnapshot: {
      findFirst: mocks.knowledgeVelocitySnapshotFindFirst,
    },
    decision: { findMany: mocks.decisionFindMany },
  } as unknown as PrismaService;

  return { service: new PulsePatternsService(prisma), mocks };
}

describe('PulsePatternsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('пустой tenant — возвращает корректный пустой DTO', async () => {
    const { service } = buildService();
    const res = await service.getPulsePatterns({
      tenantId: 't-1',
      period: 'week',
    });
    expect(res.period).toBe('week');
    expect(res.busFactor).toEqual({
      critical: [],
      warningCount: 0,
      totalCategories: 0,
    });
    expect(res.recurringTopics).toEqual({ topics: [] });
    expect(res.lowRoiMeetings).toEqual({ meetings: [] });
    expect(res.bottlenecks).toEqual({
      heatmap: [],
      departments: [],
      topPairs: [],
    });
    expect(res.goalVector).toEqual({ goals: [], primaryGoalId: null });
    expect(res.knowledgeVelocity).toEqual({
      medianHours: null,
      resolvedGapsCount: 0,
      openGapsCount: 0,
      topResponders: [],
    });
    expect(res.irreversibleDecisions).toEqual({
      decisions: [],
      alertCount: 0,
    });
  });

  it('happy path — все виджеты заполняются корректно', async () => {
    const now = new Date();
    const { service, mocks } = buildService({
      knowledgeRiskSnapshotFindMany: vi.fn(async () => [
        {
          categoryName: 'AI/LLM',
          riskLevel: 'critical',
          highConfidenceCount: 1,
          topExpertsJson: { experts: [{ name: 'Анна', personId: 'p-a' }] },
          snapshotAt: now,
        },
        {
          categoryName: 'AI/LLM',
          riskLevel: 'warning',
          highConfidenceCount: 3,
          topExpertsJson: { experts: [{ name: 'Старый', personId: 'p-x' }] },
          snapshotAt: new Date(now.getTime() - 10 * 24 * 3600 * 1000),
        },
        {
          categoryName: 'DevOps',
          riskLevel: 'warning',
          highConfidenceCount: 2,
          topExpertsJson: { experts: [] },
          snapshotAt: now,
        },
      ]),
      recurringTopicFindMany: vi.fn(async () => [
        {
          themeId: 'th-1',
          themeName: 'Авторизация ломается',
          mentionCount: 12,
          meetingCount: 5,
          windowStart: new Date(now.getTime() - 90 * 24 * 3600 * 1000),
          windowEnd: now,
          snapshotAt: now,
        },
      ]),
      meetingFindMany: vi.fn(async () => [
        {
          id: 'm-1',
          title: 'Болтология #1',
          startedAt: now,
          durationMs: 90 * 60 * 1000,
          roiScore: new Prisma.Decimal('0.500'),
          _count: { participants: 6 },
        },
      ]),
      departmentFindMany: vi.fn(async () => [
        { id: 'd-1', name: 'Маркетинг' },
        { id: 'd-2', name: 'Разработка' },
        { id: 'd-3', name: 'Продажи' },
      ]),
      crossFunctionalFrictionFindMany: vi.fn(async () => [
        {
          severity: 'high',
          involvedDepartmentIds: ['d-1', 'd-2'],
        },
        {
          severity: 'medium',
          involvedDepartmentIds: ['d-2', 'd-3'],
        },
        {
          severity: 'low',
          involvedDepartmentIds: ['d-1'],
        },
      ]),
      personGoalContributionGroupBy: vi.fn(async () => [
        {
          goalId: 'g-1',
          _sum: {
            netScore: new Prisma.Decimal('15.000'),
            proScore: new Prisma.Decimal('18.000'),
            contraScore: new Prisma.Decimal('3.000'),
          },
        },
      ]),
      goalFindMany: vi.fn(async () => [
        {
          id: 'g-1',
          name: 'Запустить продукт в Q4',
          isPrimary: true,
          weight: new Prisma.Decimal('1.0'),
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ]),
      goalFindFirst: vi.fn(async () => ({ id: 'g-1' })),
      personGoalContributionFindMany: vi.fn(async () => [
        {
          goalId: 'g-1',
          personId: 'p-1',
          proScore: new Prisma.Decimal('12.000'),
          contraScore: new Prisma.Decimal('2.000'),
          netScore: new Prisma.Decimal('10.000'),
        },
        {
          goalId: 'g-1',
          personId: 'p-2',
          proScore: new Prisma.Decimal('6.000'),
          contraScore: new Prisma.Decimal('1.000'),
          netScore: new Prisma.Decimal('5.000'),
        },
      ]),
      personFindMany: vi.fn(async () => [
        { id: 'p-1', name: 'Сергей', primaryDepartmentId: 'd-1' },
        { id: 'p-2', name: 'Анна', primaryDepartmentId: null },
      ]),
      knowledgeVelocitySnapshotFindFirst: vi.fn(async () => ({
        medianHoursToAnswer: new Prisma.Decimal('18.50'),
        resolvedGapsCount: 9,
        openGapsCount: 2,
        topRespondersJson: [
          { personId: 'p-1', name: 'Сергей', resolvedCount: 5 },
          { personId: 'p-2', name: 'Анна', resolvedCount: 3 },
        ],
      })),
      decisionFindMany: vi.fn(async () => [
        {
          id: 'd-1',
          statement: 'Закрываем сегмент B',
          text: null,
          alternatives: null,
          decidedAt: now,
          createdAt: now,
        },
        {
          id: 'd-2',
          statement: 'Поднимаем цену',
          text: null,
          alternatives: [{ option: 'оставить', reasonRejected: 'инфляция' }],
          decidedAt: null,
          createdAt: now,
        },
      ]),
    });

    const res = await service.getPulsePatterns({
      tenantId: 't-1',
      period: 'week',
    });

    expect(res.busFactor.critical).toHaveLength(1);
    expect(res.busFactor.critical[0]).toEqual({
      categoryName: 'AI/LLM',
      expertsCount: 1,
      topExperts: ['Анна'],
    });
    expect(res.busFactor.warningCount).toBe(1);
    expect(res.busFactor.totalCategories).toBe(2);

    expect(res.recurringTopics.topics).toHaveLength(1);
    expect(res.recurringTopics.topics[0]?.themeName).toBe('Авторизация ломается');
    expect(res.recurringTopics.topics[0]?.windowDays).toBe(90);

    expect(res.lowRoiMeetings.meetings).toHaveLength(1);
    expect(res.lowRoiMeetings.meetings[0]).toMatchObject({
      meetingId: 'm-1',
      durationMinutes: 90,
      participantCount: 6,
      roiScore: 0.5,
    });

    expect(res.bottlenecks.departments).toHaveLength(3);
    expect(res.bottlenecks.heatmap).toHaveLength(3);
    expect(res.bottlenecks.heatmap[0]?.[1]).toBe(3);
    expect(res.bottlenecks.heatmap[1]?.[2]).toBe(2);
    expect(res.bottlenecks.heatmap[0]?.[0]).toBe(1);
    expect(res.bottlenecks.topPairs[0]).toMatchObject({
      fromName: 'Маркетинг',
      toName: 'Разработка',
      severity: 3,
    });

    expect(res.goalVector.primaryGoalId).toBe('g-1');
    expect(res.goalVector.goals).toHaveLength(1);
    expect(res.goalVector.goals[0]).toMatchObject({
      goalId: 'g-1',
      goalTitle: 'Запустить продукт в Q4',
      isPrimary: true,
      proScore: 18,
      contraScore: 3,
      netScore: 15,
    });
    expect(res.goalVector.goals[0]?.topContributors).toEqual([
      {
        personId: 'p-1',
        personName: 'Сергей',
        proScore: 12,
        contraScore: 2,
        netScore: 10,
      },
      {
        personId: 'p-2',
        personName: 'Анна',
        proScore: 6,
        contraScore: 1,
        netScore: 5,
      },
    ]);
    const byDept = res.goalVector.goals[0]?.byDepartment ?? [];
    expect(byDept).toHaveLength(2);
    const marketing = byDept.find((d) => d.departmentId === 'd-1');
    expect(marketing).toMatchObject({
      departmentName: 'Маркетинг',
      proScore: 12,
      contraScore: 2,
      netScore: 10,
    });
    const noDept = byDept.find((d) => d.departmentId === null);
    expect(noDept).toMatchObject({
      departmentName: 'Без отдела',
      proScore: 6,
      contraScore: 1,
      netScore: 5,
    });

    expect(res.knowledgeVelocity).toEqual({
      medianHours: 18.5,
      resolvedGapsCount: 9,
      openGapsCount: 2,
      topResponders: [
        { personName: 'Сергей', resolvedCount: 5 },
        { personName: 'Анна', resolvedCount: 3 },
      ],
    });

    expect(res.irreversibleDecisions.decisions).toHaveLength(2);
    expect(res.irreversibleDecisions.alertCount).toBe(1);
    expect(res.irreversibleDecisions.decisions[0]).toMatchObject({
      decisionId: 'd-1',
      statement: 'Закрываем сегмент B',
      hasAlternatives: false,
    });
    expect(res.irreversibleDecisions.decisions[1]).toMatchObject({
      decisionId: 'd-2',
      hasAlternatives: true,
    });

    expect(mocks.knowledgeRiskSnapshotFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.recurringTopicFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.meetingFindMany).toHaveBeenCalledTimes(1);
  });

  it('period=month расширяет окно для goal vector до 12 недель', async () => {
    const { service, mocks } = buildService();
    await service.getPulsePatterns({ tenantId: 't-2', period: 'month' });

    const groupByMock = mocks.personGoalContributionGroupBy;
    expect(groupByMock).toBeDefined();
    expect(groupByMock!).toHaveBeenCalledTimes(1);
    const groupByArgs = groupByMock!.mock.calls[0]?.[0];
    expect(groupByArgs).toBeDefined();
    const gte = (groupByArgs as { where: { weekStart: { gte: Date } } }).where.weekStart.gte;
    const weeksAgo = (Date.now() - gte.getTime()) / (7 * 24 * 3600 * 1000);
    expect(weeksAgo).toBeGreaterThanOrEqual(11.5);
    expect(weeksAgo).toBeLessThanOrEqual(12.5);
  });

  type GoalVectorAccess = {
    getGoalVector: (
      tenantId: string,
      periodDays: number,
      now: Date,
    ) => Promise<{
      goals: Array<{
        goalId: string;
        goalTitle: string;
        isPrimary: boolean;
        proScore: number;
        contraScore: number;
        netScore: number;
        topContributors: Array<{
          personId: string;
          personName: string;
          proScore: number;
          contraScore: number;
          netScore: number;
        }>;
        byDepartment: Array<{
          departmentId: string | null;
          departmentName: string;
          proScore: number;
          contraScore: number;
          netScore: number;
        }>;
      }>;
      primaryGoalId: string | null;
    }>;
  };

  const FIXED_NOW = new Date('2026-06-05T00:00:00Z');

  function callGoalVector(
    service: PulsePatternsService,
    tenantId = 't1',
    periodDays = 7,
  ): ReturnType<GoalVectorAccess['getGoalVector']> {
    return (service as unknown as GoalVectorAccess).getGoalVector(tenantId, periodDays, FIXED_NOW);
  }

  it('главная цель + разрез по 2 отделам + проброс pro/contra', async () => {
    const { service, mocks } = buildService({
      personGoalContributionGroupBy: vi.fn(async () => [
        {
          goalId: 'goalA',
          _sum: {
            netScore: new Prisma.Decimal('20.000'),
            proScore: new Prisma.Decimal('25.000'),
            contraScore: new Prisma.Decimal('5.000'),
          },
        },
        {
          goalId: 'goalB',
          _sum: {
            netScore: new Prisma.Decimal('8.000'),
            proScore: new Prisma.Decimal('10.000'),
            contraScore: new Prisma.Decimal('2.000'),
          },
        },
      ]),
      goalFindFirst: vi.fn(async () => ({ id: 'goalA' })),
      goalFindMany: vi.fn(async () => [
        {
          id: 'goalA',
          name: 'Главная цель',
          isPrimary: true,
          weight: new Prisma.Decimal('1.0'),
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          id: 'goalB',
          name: 'Вторая цель',
          isPrimary: false,
          weight: new Prisma.Decimal('2.0'),
          createdAt: new Date('2026-01-02T00:00:00Z'),
        },
      ]),
      personGoalContributionFindMany: vi.fn(async () => [
        {
          goalId: 'goalA',
          personId: 'p1',
          proScore: new Prisma.Decimal('15.000'),
          contraScore: new Prisma.Decimal('3.000'),
          netScore: new Prisma.Decimal('12.000'),
        },
        {
          goalId: 'goalA',
          personId: 'p2',
          proScore: new Prisma.Decimal('7.000'),
          contraScore: new Prisma.Decimal('2.000'),
          netScore: new Prisma.Decimal('5.000'),
        },
        {
          goalId: 'goalA',
          personId: 'p3',
          proScore: new Prisma.Decimal('3.000'),
          contraScore: new Prisma.Decimal('0.000'),
          netScore: new Prisma.Decimal('3.000'),
        },
        {
          goalId: 'goalB',
          personId: 'p1',
          proScore: new Prisma.Decimal('10.000'),
          contraScore: new Prisma.Decimal('2.000'),
          netScore: new Prisma.Decimal('8.000'),
        },
      ]),
      personFindMany: vi.fn(async () => [
        { id: 'p1', name: 'Иван', primaryDepartmentId: 'dep1' },
        { id: 'p2', name: 'Пётр', primaryDepartmentId: 'dep2' },
        { id: 'p3', name: 'Без отдела', primaryDepartmentId: null },
      ]),
      departmentFindMany: vi.fn(async () => [
        { id: 'dep1', name: 'Маркетинг' },
        { id: 'dep2', name: 'Продажи' },
      ]),
    });

    const res = await callGoalVector(service);

    expect(res.primaryGoalId).toBe('goalA');
    expect(res.goals).toHaveLength(2);

    expect(mocks.departmentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 't1' }),
      }),
    );

    const goalA = res.goals.find((g) => g.goalId === 'goalA')!;
    expect(goalA.isPrimary).toBe(true);
    expect(goalA.proScore).toBeGreaterThan(0);
    expect(goalA.contraScore).toBeGreaterThan(0);
    expect(goalA.netScore).toBeCloseTo(goalA.proScore - goalA.contraScore, 3);
    expect(goalA.byDepartment).toHaveLength(3);
    const none = goalA.byDepartment.find((d) => d.departmentId === null)!;
    expect(none.departmentName).toBe('Без отдела');
    expect(none.proScore).toBeCloseTo(3, 3);

    const goalB = res.goals.find((g) => g.goalId === 'goalB')!;
    expect(goalB.isPrimary).toBe(false);
    expect(goalB.byDepartment).toHaveLength(1);
    expect(goalB.byDepartment[0]?.departmentId).toBe('dep1');
  });

  it('пустой набор — { goals: [], primaryGoalId: null } без обращения к isPrimary', async () => {
    const { service, mocks } = buildService({
      personGoalContributionGroupBy: vi.fn(async () => []),
      goalFindFirst: vi.fn(async () => ({ id: 'goalA' })),
    });

    const res = await callGoalVector(service);

    expect(res).toEqual({ goals: [], primaryGoalId: null });
    expect(mocks.goalFindFirst).not.toHaveBeenCalled();
    expect(mocks.goalFindMany).not.toHaveBeenCalled();
    expect(mocks.personGoalContributionFindMany).not.toHaveBeenCalled();
  });

  it('нет isPrimary → fallback по weight, при равном weight — min createdAt', async () => {
    const { service } = buildService({
      personGoalContributionGroupBy: vi.fn(async () => [
        {
          goalId: 'goalX',
          _sum: {
            netScore: new Prisma.Decimal('1.000'),
            proScore: new Prisma.Decimal('1.000'),
            contraScore: new Prisma.Decimal('0.000'),
          },
        },
        {
          goalId: 'goalY',
          _sum: {
            netScore: new Prisma.Decimal('1.000'),
            proScore: new Prisma.Decimal('1.000'),
            contraScore: new Prisma.Decimal('0.000'),
          },
        },
        {
          goalId: 'goalZ',
          _sum: {
            netScore: new Prisma.Decimal('1.000'),
            proScore: new Prisma.Decimal('1.000'),
            contraScore: new Prisma.Decimal('0.000'),
          },
        },
      ]),
      goalFindFirst: vi.fn(async () => null),
      goalFindMany: vi.fn(async () => [
        {
          id: 'goalX',
          name: 'X',
          isPrimary: false,
          weight: new Prisma.Decimal('2.0'),
          createdAt: new Date('2026-01-02T00:00:00Z'),
        },
        {
          id: 'goalY',
          name: 'Y',
          isPrimary: false,
          weight: new Prisma.Decimal('2.0'),
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          id: 'goalZ',
          name: 'Z',
          isPrimary: false,
          weight: new Prisma.Decimal('1.0'),
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ]),
      personGoalContributionFindMany: vi.fn(async () => []),
    });

    const res = await callGoalVector(service);

    expect(res.primaryGoalId).toBe('goalY');
  });

  it('topContributors: personId/pro/contra/net, отсортированы по убыванию |net|', async () => {
    const { service } = buildService({
      personGoalContributionGroupBy: vi.fn(async () => [
        {
          goalId: 'g1',
          _sum: {
            netScore: new Prisma.Decimal('0.000'),
            proScore: new Prisma.Decimal('20.000'),
            contraScore: new Prisma.Decimal('20.000'),
          },
        },
      ]),
      goalFindFirst: vi.fn(async () => null),
      goalFindMany: vi.fn(async () => [
        {
          id: 'g1',
          name: 'Цель',
          isPrimary: false,
          weight: new Prisma.Decimal('1.0'),
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ]),
      personGoalContributionFindMany: vi.fn(async () => [
        {
          goalId: 'g1',
          personId: 'small',
          proScore: new Prisma.Decimal('3.000'),
          contraScore: new Prisma.Decimal('1.000'),
          netScore: new Prisma.Decimal('2.000'),
        },
        {
          goalId: 'g1',
          personId: 'big',
          proScore: new Prisma.Decimal('12.000'),
          contraScore: new Prisma.Decimal('3.000'),
          netScore: new Prisma.Decimal('9.000'),
        },
        {
          goalId: 'g1',
          personId: 'neg',
          proScore: new Prisma.Decimal('1.000'),
          contraScore: new Prisma.Decimal('6.000'),
          netScore: new Prisma.Decimal('-5.000'),
        },
      ]),
      personFindMany: vi.fn(async () => [
        { id: 'small', name: 'Малый', primaryDepartmentId: null },
        { id: 'big', name: 'Большой', primaryDepartmentId: null },
        { id: 'neg', name: 'Минус', primaryDepartmentId: null },
      ]),
    });

    const res = await callGoalVector(service);

    const top = res.goals[0]!.topContributors;
    expect(top).toHaveLength(3);
    expect(top.map((c) => c.personId)).toEqual(['big', 'neg', 'small']);
    expect(top[0]).toEqual({
      personId: 'big',
      personName: 'Большой',
      proScore: 12,
      contraScore: 3,
      netScore: 9,
    });
    expect(top[1]).toMatchObject({
      personId: 'neg',
      proScore: 1,
      contraScore: 6,
      netScore: -5,
    });
  });
});

describe('dedupeLatestRecurringTopicByTheme', () => {
  it('один themeId дважды → один последний снимок (max snapshotAt)', () => {
    const rows = [
      {
        themeId: 't1',
        themeName: 'Тема 1',
        mentionCount: 3,
        snapshotAt: new Date(2026, 0, 1),
      },
      {
        themeId: 't1',
        themeName: 'Тема 1',
        mentionCount: 7,
        snapshotAt: new Date(2026, 0, 5),
      },
      {
        themeId: 't2',
        themeName: 'Тема 2',
        mentionCount: 4,
        snapshotAt: new Date(2026, 0, 2),
      },
    ];
    const out = dedupeLatestRecurringTopicByTheme(rows);
    expect(out).toHaveLength(2);
    const ids = out.map((t) => t.themeId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(out.find((t) => t.themeId === 't1')!.mentionCount).toBe(7);
  });

  it('null themeId дедупится по имени', () => {
    const rows = [
      {
        themeId: null,
        themeName: 'Без темы',
        mentionCount: 2,
        snapshotAt: new Date(2026, 0, 1),
      },
      {
        themeId: null,
        themeName: 'Без темы',
        mentionCount: 8,
        snapshotAt: new Date(2026, 0, 4),
      },
    ];
    const out = dedupeLatestRecurringTopicByTheme(rows);
    expect(out).toHaveLength(1);
    expect(out[0]!.mentionCount).toBe(8);
  });
});
