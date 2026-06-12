/**
 * RTL-тест мобильного экрана «Команда» (ТЗ B2/Ф3).
 *
 * Покрытие:
 *   (а) с данными — настроение, блок «Кому помочь», сводные числа;
 *   (б) пусто — виден empty-state, нет блока «Кому помочь»;
 *   (в) Р4 — в отрендеренном DOM НЕТ обвинительных строк
 *       «провалил/просрочил/не сдал».
 *
 * Моки: auth-context (currentOrgId), api-модуль (fetch не нужен), swr — по
 * первому элементу ключа возвращаем operations data детерминированно.
 */

import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OperationsOverviewDomain } from '@/domain/operations-dashboard';
import { MobileTeamClient } from './MobileTeamClient';

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ currentOrgId: 'org-test' }),
}));

vi.mock('@/api/operations-dashboard.api', () => ({
  operationsDashboardApi: { getOverview: vi.fn() },
}));

let opsState: { data?: unknown; error?: unknown; isLoading: boolean } = {
  data: undefined,
  error: undefined,
  isLoading: false,
};
vi.mock('swr', () => ({
  __esModule: true,
  default: () => opsState,
}));

afterEach(() => {
  vi.clearAllMocks();
});

function ops(over: Partial<OperationsOverviewDomain> = {}): OperationsOverviewDomain {
  return {
    tenantId: 't1',
    generatedAt: new Date(),
    blockersCount: 2,
    blockersBySeverity: { low: 1, medium: 1, high: 0, unknown: 0 },
    missedGoalsCount: 0,
    cascadeMissedCount: 0,
    teamFrictionCount: 1,
    capacityAvgPercent: 0,
    capacityOverloadedCount: 1,
    topRecentBlockers: [
      {
        id: 'b1',
        text: 'Не подписан договор',
        severity: 'high',
        ownerHint: null,
        ownerPersonId: 'p9',
        ownerPersonName: 'Ольга',
        createdAt: '2026-06-10T00:00:00.000Z',
        sourceBlockId: null,
        sourceCheckInId: null,
      },
    ],
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

function emptyOps(): OperationsOverviewDomain {
  return ops({
    blockersCount: 0,
    teamFrictionCount: 0,
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
  });
}

describe('MobileTeamClient', () => {
  it('(а) с данными — настроение, «Кому помочь», сводные числа', () => {
    opsState = { data: ops(), error: undefined, isLoading: false };
    render(<MobileTeamClient />);

    expect(screen.getByText('Настроение команды')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('Кому помочь')).toBeInTheDocument();
    expect(screen.getByText('Не подписан договор')).toBeInTheDocument();
    expect(screen.getByText('Ольга · нужна помощь')).toBeInTheDocument();
    expect(screen.getByText('Блокеры')).toBeInTheDocument();
  });

  it('(б) пусто — empty-state, без «Кому помочь»', () => {
    opsState = { data: emptyOps(), error: undefined, isLoading: false };
    render(<MobileTeamClient />);

    expect(screen.getByTestId('team-empty')).toBeInTheDocument();
    expect(screen.queryByText('Кому помочь')).toBeNull();
  });

  it('(в) Р4 — нет обвинительных строк «провалил/просрочил/не сдал»', () => {
    opsState = { data: ops(), error: undefined, isLoading: false };
    const { container } = render(<MobileTeamClient />);
    expect(container.textContent ?? '').not.toMatch(/провалил|просрочил|не сдал/i);
  });
});
