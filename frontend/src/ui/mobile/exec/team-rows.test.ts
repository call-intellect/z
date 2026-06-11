/**
 * Юнит-тесты чистой логики экрана «Команда» (мобайл, ТЗ B2/Ф3).
 *
 * Покрытие: тон/процент настроения, ряды «кому помочь» (блокеры + трения) с
 * проверкой Р4 (никаких «провалил/просрочил»), сводные числа, cold-start.
 */

import { describe, expect, it } from 'vitest';

import type { OperationsOverviewDomain } from '@/domain/operations-dashboard';
import type {
  OperationsBlockerApi,
  OperationsTeamFrictionApi,
} from '@/api/operations-dashboard.api';
import {
  isTeamEmpty,
  moodGreenPercent,
  moodTone,
  teamHelpRows,
  teamSummaryStats,
} from './team-rows';

function blocker(over: Partial<OperationsBlockerApi> = {}): OperationsBlockerApi {
  return {
    id: 'b1',
    text: 'Не подписан договор с подрядчиком',
    severity: 'medium',
    ownerHint: null,
    ownerPersonId: null,
    ownerPersonName: null,
    createdAt: '2026-06-10T00:00:00.000Z',
    sourceBlockId: null,
    sourceCheckInId: null,
    ...over,
  };
}

function friction(
  over: Partial<OperationsTeamFrictionApi> = {},
): OperationsTeamFrictionApi {
  return {
    id: 'f1',
    fromPersonId: 'p1',
    fromPersonName: 'Иван',
    toPersonId: 'p2',
    toPersonName: 'Пётр',
    relationType: 'tension',
    confidence: 0.8,
    explanation: '...',
    observedAt: '2026-06-10T00:00:00.000Z',
    ...over,
  };
}

function ops(over: Partial<OperationsOverviewDomain> = {}): OperationsOverviewDomain {
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

describe('moodTone / moodGreenPercent', () => {
  it('0.8 при 10 чек-инах → ok / 80%', () => {
    const u = ops({
      teamTemperature: {
        days: 7,
        totalCheckIns: 10,
        greenShare: 0.8,
        yellowShare: 0.1,
        redShare: 0.1,
        redShareDelta: null,
      },
    });
    expect(moodTone(0.8, 10)).toBe('ok');
    expect(moodGreenPercent(u)).toBe(80);
  });

  it('нет чек-инов → neutral / null', () => {
    expect(moodTone(0, 0)).toBe('neutral');
    expect(moodGreenPercent(ops())).toBeNull();
  });

  it('0.5 → warn, 0.3 → danger', () => {
    expect(moodTone(0.5, 5)).toBe('warn');
    expect(moodTone(0.3, 5)).toBe('danger');
  });
});

describe('teamHelpRows (Р4: «кому помочь», без обвинений)', () => {
  it('блокер с владельцем → «Имя · нужна помощь», ссылка на персону', () => {
    const u = ops({
      topRecentBlockers: [
        blocker({ ownerPersonId: 'p9', ownerPersonName: 'Ольга', severity: 'high' }),
      ],
    });
    const rows = teamHelpRows(u);
    expect(rows[0].meta).toBe('Ольга · нужна помощь');
    expect(rows[0].tone).toBe('danger'); // high
    expect(rows[0].href).toBe('/structure/persons/p9');
  });

  it('блокер без владельца → «нужна помощь», без href', () => {
    const u = ops({ topRecentBlockers: [blocker()] });
    const rows = teamHelpRows(u);
    expect(rows[0].meta).toBe('нужна помощь');
    expect(rows[0].href).toBeUndefined();
  });

  it('трение → «нужно сгладить»', () => {
    const u = ops({ topRecentTeamFrictions: [friction()] });
    const rows = teamHelpRows(u);
    const fr = rows.find((r) => r.id.startsWith('friction-'))!;
    expect(fr.meta).toBe('нужно сгладить');
    expect(fr.title).toBe('Иван ↔ Пётр');
  });

  it('ни одна мета/заголовок не содержит обвинительных слов', () => {
    const u = ops({
      topRecentBlockers: [blocker({ ownerPersonName: 'Ольга' })],
      topRecentTeamFrictions: [friction()],
    });
    const joined = teamHelpRows(u)
      .map((r) => `${r.title} ${r.meta ?? ''}`)
      .join(' ');
    expect(joined).not.toMatch(/провалил|просрочил|не сдал/i);
  });
});

describe('teamSummaryStats', () => {
  it('блокеры>0 → danger, перегруз>0 → warn, нули → ok', () => {
    const u = ops({
      blockersCount: 2,
      teamFrictionCount: 0,
      capacityOverloadedCount: 1,
    });
    const stats = teamSummaryStats(u);
    expect(stats.find((s) => s.key === 'blockers')!.tone).toBe('danger');
    expect(stats.find((s) => s.key === 'frictions')!.tone).toBe('ok');
    expect(stats.find((s) => s.key === 'overloaded')!.tone).toBe('warn');
  });
});

describe('isTeamEmpty', () => {
  it('null → true; всё по нулям → true; есть блокер → false', () => {
    expect(isTeamEmpty(null)).toBe(true);
    expect(isTeamEmpty(ops())).toBe(true);
    expect(
      isTeamEmpty(ops({ blockersCount: 1, topRecentBlockers: [blocker()] })),
    ).toBe(false);
  });
});
