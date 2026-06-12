/**
 * Юнит-тесты чистой логики экрана «Обзор» (мобайл, ТЗ B1/Ф2).
 *
 * Покрытие:
 *   - overviewZonesFromDomain — 4 зоны в правильном порядке + значения/тон;
 *   - requiresYouCount — total из requiresAction, fallback на signalCounters, 0;
 *   - mainGoalPercent — strategicAlignment.average→%, fallback goalsPulse, null;
 *   - isOverviewColdStart — isEmpty=true.
 */

import { describe, expect, it } from 'vitest';

import type { DirectorDashboardDomain } from '@/domain/director-dashboard';
import type { OperationsOverviewDomain } from '@/domain/operations-dashboard';
import {
  isOverviewColdStart,
  mainGoalPercent,
  overviewZonesFromDomain,
  requiresYouCount,
} from './overview-zones';

function makeDirector(
  over: Partial<DirectorDashboardDomain> = {},
): DirectorDashboardDomain {
  return {
    period: 'week',
    generatedAt: new Date(),
    newThemes: [],
    newSignals: [],
    signalCounters: {
      pain: 0,
      feature_request: 0,
      churn_risk: 0,
      objection: 0,
      risk: 0,
      decision: 0,
      commitment: 0,
      other: 0,
    },
    activeThemes: [],
    hotEntities: [],
    openQuestions: [],
    narrativeSummary: null,
    kpiSentimentIndex: null,
    kpiCommitmentReliability: null,
    kpiHangingDecisions: null,
    strategicAlignment: null,
    requiresAction: null,
    goalsTree: null,
    goalsPulse: null,
    isEmpty: false,
    valueStrip: {
      meetingsProtocoled: 0,
      tasksExtracted: 0,
      decisionsExtracted: 0,
      questionsAnsweredByMemory: 0,
      commitmentsKept: 0,
    },
    mainReworkEnabled: true,
    ...over,
  };
}

function makeOperations(
  over: Partial<OperationsOverviewDomain> = {},
): OperationsOverviewDomain {
  return {
    tenantId: 't1',
    generatedAt: new Date(),
    blockersCount: 0,
    blockersBySeverity: { low: 0, medium: 0, high: 0, unknown: 0 },
    missedGoalsCount: 0,
    cascadeMissedCount: 0,
    teamFrictionCount: 0,
    capacityAvgPercent: 0,
    capacityOverloadedCount: 0,
    topRecentBlockers: [],
    topRecentTeamFrictions: [],
    teamTemperature: {
      days: 7,
      totalCheckIns: 0,
      greenShare: 0,
      yellowShare: 0,
      redShare: 0,
      redShareDelta: null,
    },
    insightsByCauseCategory: {
      process_gap: 0,
      tooling: 0,
      role_skill: 0,
      communication: 0,
      priority: 0,
      resource_constraint: 0,
      external: 0,
      unknown: 0,
    },
    maturity: {
      score: null,
      scorePercent: null,
      lastCalcAt: null,
      stage: null,
      weakestDomains: [],
      topDomains: [],
    },
    blockersResolvedCount: 0,
    frictionsResolvedCount: 0,
    reworkEnabled: true,
    weeklyInflow: { blockers: [], frictions: [] },
    ...over,
  };
}

describe('overviewZonesFromDomain', () => {
  it('возвращает ровно 4 зоны в порядке Команда/Дела/Главная цель/Что мешает', () => {
    const zones = overviewZonesFromDomain(makeDirector(), makeOperations());
    expect(zones.map((z) => z.key)).toEqual(['team', 'deals', 'goal', 'blockers']);
  });

  it('Команда: greenShare 0.8 → 80% и тон ok', () => {
    const ops = makeOperations({
      teamTemperature: {
        days: 7,
        totalCheckIns: 10,
        greenShare: 0.8,
        yellowShare: 0.1,
        redShare: 0.1,
        redShareDelta: null,
      },
    });
    const team = overviewZonesFromDomain(makeDirector(), ops).find((z) => z.key === 'team')!;
    expect(team.value).toBe('80%');
    expect(team.tone).toBe('ok');
  });

  it('Команда без чек-инов → «—» и тон neutral', () => {
    const team = overviewZonesFromDomain(makeDirector(), makeOperations()).find(
      (z) => z.key === 'team',
    )!;
    expect(team.value).toBe('—');
    expect(team.tone).toBe('neutral');
  });

  it('Дела: commitmentReliability 90% → ok, 50% → danger', () => {
    const ok = overviewZonesFromDomain(
      makeDirector({
        kpiCommitmentReliability: { value: 90, sparkline: [], delta: null },
      }),
      makeOperations(),
    ).find((z) => z.key === 'deals')!;
    expect(ok.value).toBe('90%');
    expect(ok.tone).toBe('ok');

    const bad = overviewZonesFromDomain(
      makeDirector({
        kpiCommitmentReliability: { value: 50, sparkline: [], delta: null },
      }),
      makeOperations(),
    ).find((z) => z.key === 'deals')!;
    expect(bad.tone).toBe('danger');
  });

  it('Главная цель: strategicAlignment.average 0.75 → 75% (gaugePercent)', () => {
    const goal = overviewZonesFromDomain(
      makeDirector({
        strategicAlignment: { average: 0.75, goalsCount: 3, alertGoals: [] },
      }),
      makeOperations(),
    ).find((z) => z.key === 'goal')!;
    expect(goal.value).toBe('75%');
    expect(goal.gaugePercent).toBe(75);
    expect(goal.tone).toBe('ok');
  });

  it('Что мешает: blockersCount 3 → значение «3» и тон danger', () => {
    const blockers = overviewZonesFromDomain(
      makeDirector(),
      makeOperations({ blockersCount: 3 }),
    ).find((z) => z.key === 'blockers')!;
    expect(blockers.value).toBe('3');
    expect(blockers.tone).toBe('danger');
  });

  it('operations=null → плитки команды/блокеров «—»/neutral, экран не падает', () => {
    const zones = overviewZonesFromDomain(makeDirector(), null);
    const team = zones.find((z) => z.key === 'team')!;
    const blockers = zones.find((z) => z.key === 'blockers')!;
    expect(team.value).toBe('—');
    expect(team.tone).toBe('neutral');
    expect(blockers.value).toBe('—');
    expect(blockers.tone).toBe('neutral');
  });
});

describe('requiresYouCount', () => {
  it('берёт requiresAction.total когда блок есть', () => {
    const d = makeDirector({
      requiresAction: {
        total: 4,
        bySource: { curation: 1, conflict: 1, intake: 1, probe: 1 },
      },
    });
    expect(requiresYouCount(d)).toBe(4);
  });

  it('total=0 → 0 (строка «Требует тебя» не показывается)', () => {
    const d = makeDirector({
      requiresAction: {
        total: 0,
        bySource: { curation: 0, conflict: 0, intake: 0, probe: 0 },
      },
    });
    expect(requiresYouCount(d)).toBe(0);
  });

  it('нет requiresAction → fallback на сумму signalCounters', () => {
    const d = makeDirector({
      requiresAction: null,
      signalCounters: {
        pain: 2,
        feature_request: 1,
        churn_risk: 0,
        objection: 0,
        risk: 1,
        decision: 0,
        commitment: 0,
        other: 0,
      },
    });
    expect(requiresYouCount(d)).toBe(4);
  });

  it('director=null → 0', () => {
    expect(requiresYouCount(null)).toBe(0);
  });
});

describe('mainGoalPercent', () => {
  it('strategicAlignment.average имеет приоритет', () => {
    const d = makeDirector({
      strategicAlignment: { average: 0.6, goalsCount: 2, alertGoals: [] },
      goalsPulse: {
        onTrackCount: 0,
        atRiskCount: 0,
        stalledCount: 0,
        achievedCount: 0,
        droppedCount: 0,
        total: 0,
      },
    });
    expect(mainGoalPercent(d)).toBe(60);
  });

  it('fallback на goalsPulse: onTrack/(total-dropped)', () => {
    const d = makeDirector({
      strategicAlignment: { average: null, goalsCount: 0, alertGoals: [] },
      goalsPulse: {
        onTrackCount: 3,
        atRiskCount: 1,
        stalledCount: 0,
        achievedCount: 0,
        droppedCount: 0,
        total: 4,
      },
    });
    expect(mainGoalPercent(d)).toBe(75);
  });

  it('нет данных → null', () => {
    expect(mainGoalPercent(makeDirector())).toBeNull();
  });
});

describe('isOverviewColdStart', () => {
  it('isEmpty=true → true', () => {
    expect(isOverviewColdStart(makeDirector({ isEmpty: true }))).toBe(true);
  });
  it('isEmpty=false → false', () => {
    expect(isOverviewColdStart(makeDirector())).toBe(false);
  });
  it('null → false', () => {
    expect(isOverviewColdStart(null)).toBe(false);
  });
});
