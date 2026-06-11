/**
 * RTL-тест мобильного экрана «Обзор» (ТЗ B1/Ф2).
 *
 * Покрытие:
 *   (а) с данными — рендерятся 4 зоны (Команда/Дела/Главная цель/Что мешает)
 *       + полоса «Кора за неделю» + кнопка «Спросить»;
 *   (б) isEmpty=true — виден cold-start маркер, плиток зон нет;
 *   (в) requiresAction.total=0 — строки «Требует тебя» нет.
 *
 * Моки: auth-context (currentOrgId), api-модули (fetch не нужен), swr — по
 * первому элементу ключа возвращаем director/operations data детерминированно.
 */

import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DirectorDashboardDomain } from '@/domain/director-dashboard';
import type { OperationsOverviewDomain } from '@/domain/operations-dashboard';
import { MobileOverviewClient } from './MobileOverviewClient';

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ currentOrgId: 'org-test' }),
}));

vi.mock('@/api/dashboard.api', () => ({
  dashboardApi: { getDirectorView: vi.fn() },
}));
vi.mock('@/api/operations-dashboard.api', () => ({
  operationsDashboardApi: { getOverview: vi.fn() },
}));
// Маппер вызывается внутри fetcher — но fetcher не выполняется (swr замокан),
// поэтому маппер не нужен. На всякий случай оставляем реальный.

// useSWR: различаем источник по первому элементу ключа.
let directorState: { data?: unknown; error?: unknown; isLoading: boolean } = {
  data: undefined,
  error: undefined,
  isLoading: false,
};
let operationsState: { data?: unknown; error?: unknown; isLoading: boolean } = {
  data: undefined,
  error: undefined,
  isLoading: false,
};
vi.mock('swr', () => ({
  __esModule: true,
  default: (key: unknown) => {
    const k = Array.isArray(key) ? key[0] : key;
    if (k === 'operations-overview') return operationsState;
    return directorState; // 'mobile-overview-director' или null
  },
}));

afterEach(() => {
  vi.clearAllMocks();
});

function director(over: Partial<DirectorDashboardDomain> = {}): DirectorDashboardDomain {
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
    kpiCommitmentReliability: { value: 88, sparkline: [], delta: null },
    kpiHangingDecisions: null,
    strategicAlignment: { average: 0.72, goalsCount: 3, alertGoals: [] },
    requiresAction: { total: 0, bySource: { curation: 0, conflict: 0, intake: 0, probe: 0 } },
    goalsTree: null,
    goalsPulse: null,
    isEmpty: false,
    valueStrip: {
      meetingsProtocoled: 5,
      tasksExtracted: 12,
      decisionsExtracted: 3,
      questionsAnsweredByMemory: 7,
      commitmentsKept: 9,
    },
    mainReworkEnabled: true,
    ...over,
  };
}

function operations(over: Partial<OperationsOverviewDomain> = {}): OperationsOverviewDomain {
  return {
    tenantId: 't1',
    generatedAt: new Date(),
    blockersCount: 2,
    blockersBySeverity: { low: 1, medium: 1, high: 0, unknown: 0 },
    missedGoalsCount: 0,
    cascadeMissedCount: 0,
    teamFrictionCount: 0,
    capacityAvgPercent: 0,
    capacityOverloadedCount: 0,
    topRecentBlockers: [],
    topRecentTeamFrictions: [],
    teamTemperature: {
      days: 7,
      totalCheckIns: 10,
      greenShare: 0.8,
      yellowShare: 0.1,
      redShare: 0.1,
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

describe('MobileOverviewClient', () => {
  it('(а) с данными — 4 зоны + «Кора за неделю» + «Спросить»', () => {
    directorState = { data: director(), error: undefined, isLoading: false };
    operationsState = { data: operations(), error: undefined, isLoading: false };
    render(<MobileOverviewClient />);

    expect(screen.getByText('Команда')).toBeInTheDocument();
    expect(screen.getByText('Дела')).toBeInTheDocument();
    expect(screen.getByText('Главная цель')).toBeInTheDocument();
    expect(screen.getByText('Что мешает')).toBeInTheDocument();
    expect(screen.getByText('Кора за неделю')).toBeInTheDocument();
    expect(screen.getByText('Спросить Кору')).toBeInTheDocument();
  });

  it('(б) isEmpty=true — cold-start маркер виден, плиток зон нет', () => {
    directorState = { data: director({ isEmpty: true }), error: undefined, isLoading: false };
    operationsState = { data: operations(), error: undefined, isLoading: false };
    render(<MobileOverviewClient />);

    expect(screen.getByTestId('overview-coldstart')).toBeInTheDocument();
    expect(screen.getByText('Граф ещё наполняется')).toBeInTheDocument();
    // Зоны не рендерятся при cold-start.
    expect(screen.queryByText('Команда')).toBeNull();
    expect(screen.queryByText('Что мешает')).toBeNull();
  });

  it('(в) requiresAction.total=0 — строки «Требует тебя» нет', () => {
    directorState = { data: director(), error: undefined, isLoading: false };
    operationsState = { data: operations(), error: undefined, isLoading: false };
    render(<MobileOverviewClient />);
    expect(screen.queryByText('Требует тебя')).toBeNull();
  });

  it('requiresAction.total>0 — строка «Требует тебя» показана', () => {
    directorState = {
      data: director({
        requiresAction: { total: 3, bySource: { curation: 1, conflict: 0, intake: 1, probe: 1 } },
      }),
      error: undefined,
      isLoading: false,
    };
    operationsState = { data: operations(), error: undefined, isLoading: false };
    render(<MobileOverviewClient />);
    const label = screen.getByText('Требует тебя');
    expect(label).toBeInTheDocument();
    // Число счётчика — внутри той же строки-ссылки, что и подпись.
    expect(label.parentElement).toHaveTextContent('3');
  });
});
