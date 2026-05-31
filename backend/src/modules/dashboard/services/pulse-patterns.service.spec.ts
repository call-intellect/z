/**
 * Unit-тесты `PulsePatternsService` (Pulse Wave 6).
 *
 * Цели:
 *   - happy-path: все 7 виджетов мокаются и собираются в один DTO.
 *   - пустой tenant: ничего не падает, все массивы — пустые.
 *   - period 'month': окно расширяется (4w → 12w для goal vector), запросы
 *     к Prisma делаются с правильным since.
 */
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { PulsePatternsService } from './pulse-patterns.service';

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
    goalFindMany: vi.fn(async () => []),
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
    personGoalContribution: {
      groupBy: mocks.personGoalContributionGroupBy,
      findMany: mocks.personGoalContributionFindMany,
    },
    goal: { findMany: mocks.goalFindMany },
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
    expect(res.goalVector).toEqual({ goals: [] });
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
      // Bus Factor: 2 snapshot'а для cat-A (берём свежий), 1 для cat-B.
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
        { goalId: 'g-1', _sum: { netScore: new Prisma.Decimal('15.000') } },
      ]),
      goalFindMany: vi.fn(async () => [
        { id: 'g-1', name: 'Запустить продукт в Q4' },
      ]),
      personGoalContributionFindMany: vi.fn(async () => [
        {
          goalId: 'g-1',
          personId: 'p-1',
          netScore: new Prisma.Decimal('10.000'),
          person: { name: 'Сергей' },
        },
        {
          goalId: 'g-1',
          personId: 'p-2',
          netScore: new Prisma.Decimal('5.000'),
          person: { name: 'Анна' },
        },
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
    // d-1×d-2 = high (3); d-2×d-3 = medium (2); d-1×d-1 (диагональ) = low (1).
    expect(res.bottlenecks.heatmap[0]?.[1]).toBe(3);
    expect(res.bottlenecks.heatmap[1]?.[2]).toBe(2);
    expect(res.bottlenecks.heatmap[0]?.[0]).toBe(1);
    expect(res.bottlenecks.topPairs[0]).toMatchObject({
      fromName: 'Маркетинг',
      toName: 'Разработка',
      severity: 3,
    });

    expect(res.goalVector.goals).toHaveLength(1);
    expect(res.goalVector.goals[0]).toMatchObject({
      goalId: 'g-1',
      goalTitle: 'Запустить продукт в Q4',
      netScore: 15,
    });
    expect(res.goalVector.goals[0]?.topContributors).toEqual([
      { personName: 'Сергей', netScore: 10 },
      { personName: 'Анна', netScore: 5 },
    ]);

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

    // sanity: основные запросы вызваны.
    expect(mocks.knowledgeRiskSnapshotFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.recurringTopicFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.meetingFindMany).toHaveBeenCalledTimes(1);
  });

  it('period=month расширяет окно для goal vector до 12 недель', async () => {
    const { service, mocks } = buildService();
    await service.getPulsePatterns({ tenantId: 't-2', period: 'month' });

    // groupBy вызван с weekStart.gte; проверим что разница ≥ 11 недель.
    const groupByMock = mocks.personGoalContributionGroupBy;
    expect(groupByMock).toBeDefined();
    expect(groupByMock!).toHaveBeenCalledTimes(1);
    const groupByArgs = groupByMock!.mock.calls[0]?.[0];
    expect(groupByArgs).toBeDefined();
    const gte = (groupByArgs as { where: { weekStart: { gte: Date } } }).where
      .weekStart.gte;
    const weeksAgo = (Date.now() - gte.getTime()) / (7 * 24 * 3600 * 1000);
    expect(weeksAgo).toBeGreaterThanOrEqual(11.5);
    expect(weeksAgo).toBeLessThanOrEqual(12.5);
  });
});
