import { describe, expect, it } from 'vitest';

import type { MonthlyDigestVerdictDto } from '../dto/monthly-digest.dto';
import { mondaysInMonth } from '../services/monthly-digest.service';

import {
  buildMonthWeekTrend,
  clampMonthVerdict,
  extractMonthCompanyResponse,
  type MonthCompanyPackageWeek,
  type MonthVerdictSignals,
} from './monthly-digest.prompt';

function baseVerdict(): MonthlyDigestVerdictDto {
  return {
    overall: { state: 'ok', emoji: '✅', title: 'Месяц', oneLiner: 'итог' },
    axes: [
      { key: 'team', state: 'ok', label: 'Норма', why: 'w' },
      { key: 'clients', state: 'ok', label: 'ок', why: 'w' },
      { key: 'execution', state: 'ok', label: 'ок', why: 'w' },
      { key: 'overall', state: 'ok', label: 'ок', why: 'w' },
    ],
  };
}

const VALID_MONTH_COMPANY = {
  verdict: {
    overall: { state: 'warn', emoji: '⚠️', title: 'Месяц сдвига', oneLiner: 'итог' },
    axes: [
      { key: 'team', state: 'ok', label: 'Норма', why: 'w' },
      { key: 'clients', state: 'ok', label: 'ок', why: 'w' },
      { key: 'execution', state: 'warn', label: 'Буксует', why: 'w' },
      { key: 'overall', state: 'warn', label: 'Сдвиг', why: 'w' },
    ],
  },
  letter: [{ key: 'main', title: 'Главное', prose: 'проза' }],
  goalAlignmentMonth: {
    direction: 'drift',
    score: 41,
    monthDelta: '+2 из 10',
    leadingSignal: 'найм закрывает дыру',
    why: 'w',
    pro: [],
    contra: [],
  },
  decisions: [{ title: 'Нанять PM', why: 'тащит один' }],
  nextFocus: [{ title: 'Закрыть онбординг', why: 'долг недель' }],
  risksSummary: 'r',
  ideasSummary: 'i',
};

describe('clampMonthVerdict', () => {
  it('негативный клиентский сигнал поднимает clients ok→risk', () => {
    const signals: MonthVerdictSignals = {
      hasNegativeClientSignal: true,
      executionStrained: false,
    };
    const out = clampMonthVerdict(baseVerdict(), signals);
    const clients = out.axes.find((a) => a.key === 'clients')!;
    expect(clients.state).not.toBe('ok');
    expect(clients.state).toBe('risk');
  });

  it('executionStrained поднимает execution ok→warn и overall не ниже warn', () => {
    const signals: MonthVerdictSignals = {
      hasNegativeClientSignal: false,
      executionStrained: true,
    };
    const out = clampMonthVerdict(baseVerdict(), signals);
    const execution = out.axes.find((a) => a.key === 'execution')!;
    const overallAxis = out.axes.find((a) => a.key === 'overall')!;
    expect(execution.state).toBe('warn');
    expect(out.overall.state).not.toBe('ok');
    expect(overallAxis.state).not.toBe('ok');
  });

  it('зелёный остаётся зелёным при пустых сигналах', () => {
    const signals: MonthVerdictSignals = {
      hasNegativeClientSignal: false,
      executionStrained: false,
    };
    const out = clampMonthVerdict(baseVerdict(), signals);
    expect(out.overall.state).toBe('ok');
    for (const a of out.axes) expect(a.state).toBe('ok');
  });
});

describe('extractMonthCompanyResponse', () => {
  it('GOLDEN: полный валидный JSON в text → распарсился', () => {
    const out = extractMonthCompanyResponse({
      text: JSON.stringify(VALID_MONTH_COMPANY),
    });
    expect(out).not.toBeNull();
    expect(out!.verdict.overall.title).toBe('Месяц сдвига');
    expect(out!.decisions).toHaveLength(1);
    expect(out!.nextFocus).toHaveLength(1);
    expect(out!.goalAlignmentMonth.leadingSignal).toContain('найм');
  });

  it('REJECT: мусор → null', () => {
    expect(extractMonthCompanyResponse({ text: 'это не json' })).toBeNull();
    expect(extractMonthCompanyResponse({ text: '' })).toBeNull();
  });

  it('невалидный enum direction → .catch дефолт drift', () => {
    const broken = {
      ...VALID_MONTH_COMPANY,
      goalAlignmentMonth: {
        ...VALID_MONTH_COMPANY.goalAlignmentMonth,
        direction: 'nonsense',
      },
    };
    const out = extractMonthCompanyResponse({ text: JSON.stringify(broken) });
    expect(out).not.toBeNull();
    expect(out!.goalAlignmentMonth.direction).toBe('drift');
  });
});

describe('buildMonthWeekTrend', () => {
  const weekStarts = ['2026-05-04', '2026-05-11', '2026-05-18', '2026-05-25'];
  const weeks: MonthCompanyPackageWeek[] = [
    {
      weekStart: '2026-05-04',
      overallState: 'ok',
      title: null,
      oneLiner: null,
      axes: [
        { key: 'team', state: 'ok' },
        { key: 'clients', state: 'warn' },
      ],
    },
    {
      weekStart: '2026-05-18',
      overallState: 'risk',
      title: null,
      oneLiner: null,
      axes: [{ key: 'clients', state: 'risk' }],
    },
  ];

  it('4 оси, у каждой длина = числу недель', () => {
    const trend = buildMonthWeekTrend(weeks, weekStarts);
    expect(trend).toHaveLength(4);
    expect(trend.map((t) => t.key)).toEqual(['team', 'clients', 'execution', 'overall']);
    for (const axis of trend) {
      expect(axis.weeks).toHaveLength(weekStarts.length);
      expect(weekStarts.length).toBeLessThanOrEqual(5);
    }
  });

  it('пустая неделя → state none', () => {
    const trend = buildMonthWeekTrend(weeks, weekStarts);
    const teamAxis = trend.find((t) => t.key === 'team')!;
    const byWeek = new Map(teamAxis.weeks.map((w) => [w.weekStart, w.state]));
    expect(byWeek.get('2026-05-11')).toBe('none');
    expect(byWeek.get('2026-05-25')).toBe('none');
    expect(byWeek.get('2026-05-04')).toBe('ok');
  });

  it('overall берёт overallState недели', () => {
    const trend = buildMonthWeekTrend(weeks, weekStarts);
    const overallAxis = trend.find((t) => t.key === 'overall')!;
    const byWeek = new Map(overallAxis.weeks.map((w) => [w.weekStart, w.state]));
    expect(byWeek.get('2026-05-04')).toBe('ok');
    expect(byWeek.get('2026-05-18')).toBe('risk');
    expect(byWeek.get('2026-05-11')).toBe('none');
  });
});

describe('mondaysInMonth', () => {
  it('май 2026 → понедельники 04, 11, 18, 25', () => {
    const mondays = mondaysInMonth('2026-05');
    expect(mondays).toEqual(['2026-05-04', '2026-05-11', '2026-05-18', '2026-05-25']);
    for (const m of mondays) {
      expect(new Date(`${m}T00:00:00.000Z`).getUTCDay()).toBe(1);
    }
  });
});
