import { describe, expect, it } from 'vitest';

import type { WeekCompanyPackageDay } from '../prompts/weekly-digest.prompt';

import { buildWeekDayTrend } from './weekly-digest.service';

describe('buildWeekDayTrend', () => {
  const weekDates = ['2026-05-18', '2026-05-19', '2026-05-20', '2026-05-21', '2026-05-22'];

  const days: WeekCompanyPackageDay[] = [
    {
      dateLocal: '2026-05-18',
      overallState: 'ok',
      title: null,
      shortSummary: null,
      axes: [
        { key: 'team', state: 'ok' },
        { key: 'clients', state: 'warn' },
        { key: 'execution', state: 'ok' },
        { key: 'overall', state: 'ok' },
      ],
      letter: null,
    },
    {
      dateLocal: '2026-05-20',
      overallState: 'warn',
      title: null,
      shortSummary: null,
      axes: [
        { key: 'team', state: 'risk' },
        { key: 'execution', state: 'warn' },
      ],
      letter: null,
    },
    {
      dateLocal: '2026-05-22',
      overallState: 'risk',
      title: null,
      shortSummary: null,
      axes: [{ key: 'clients', state: 'risk' }],
      letter: null,
    },
  ];

  it('4 оси, у каждой 5 дней', () => {
    const trend = buildWeekDayTrend(days, weekDates);
    expect(trend).toHaveLength(4);
    expect(trend.map((t) => t.key)).toEqual(['team', 'clients', 'execution', 'overall']);
    for (const axis of trend) {
      expect(axis.days).toHaveLength(5);
    }
  });

  it('пропущенные даты → state none', () => {
    const trend = buildWeekDayTrend(days, weekDates);
    const teamAxis = trend.find((t) => t.key === 'team')!;
    const byDate = new Map(teamAxis.days.map((d) => [d.dateLocal, d.state]));
    expect(byDate.get('2026-05-19')).toBe('none');
    expect(byDate.get('2026-05-21')).toBe('none');
  });

  it('присутствующие даты → state из дневного вердикта', () => {
    const trend = buildWeekDayTrend(days, weekDates);
    const clientsAxis = trend.find((t) => t.key === 'clients')!;
    const byDate = new Map(clientsAxis.days.map((d) => [d.dateLocal, d.state]));
    expect(byDate.get('2026-05-18')).toBe('warn');
    expect(byDate.get('2026-05-22')).toBe('risk');
    expect(byDate.get('2026-05-20')).toBe('none');
  });

  it('ось overall берёт overallState дня', () => {
    const trend = buildWeekDayTrend(days, weekDates);
    const overallAxis = trend.find((t) => t.key === 'overall')!;
    const byDate = new Map(overallAxis.days.map((d) => [d.dateLocal, d.state]));
    expect(byDate.get('2026-05-18')).toBe('ok');
    expect(byDate.get('2026-05-20')).toBe('warn');
    expect(byDate.get('2026-05-22')).toBe('risk');
    expect(byDate.get('2026-05-19')).toBe('none');
  });
});
