import { describe, expect, it } from 'vitest';

import type { WeeklyDigestVerdictDto } from '../dto/weekly-digest.dto';
import type { WeekCompanyPackage } from '../prompts/weekly-digest.prompt';

import { clampWeekVerdict, computeWeekVerdictSignals } from './weekly-digest.service';

function emptyTeam(over?: Partial<WeekCompanyPackage['team']>): WeekCompanyPackage['team'] {
  return {
    reliabilityPercent: null,
    tasksDone: 0,
    tasksPlanned: 0,
    tasksNotDone: 0,
    topRisk: [],
    ...over,
  };
}

function pkg(over: Partial<WeekCompanyPackage>): WeekCompanyPackage {
  return {
    weekStart: '2026-05-18',
    weekEnd: '2026-05-22',
    goalId: null,
    goalName: null,
    days: [],
    team: emptyTeam(),
    repeatedBlockers: [],
    repeatedRisks: [],
    compass: null,
    prevWeek: null,
    missingDays: [],
    ...over,
  };
}

function verdict(
  states: { team: string; clients: string; execution: string; overall: string },
  overallState: 'ok' | 'warn' | 'risk' = 'ok',
): WeeklyDigestVerdictDto {
  return {
    overall: { state: overallState, emoji: '✅', title: 'Неделя', oneLiner: 'итог' },
    axes: [
      { key: 'team', state: states.team as 'ok' | 'warn' | 'risk', label: 'l', why: 'w' },
      { key: 'clients', state: states.clients as 'ok' | 'warn' | 'risk', label: 'l', why: 'w' },
      {
        key: 'execution',
        state: states.execution as 'ok' | 'warn' | 'risk',
        label: 'l',
        why: 'w',
      },
      { key: 'overall', state: states.overall as 'ok' | 'warn' | 'risk', label: 'l', why: 'w' },
    ],
  };
}

describe('computeWeekVerdictSignals', () => {
  it('день с осью clients=risk → hasNegativeClientSignal=true', () => {
    const p = pkg({
      days: [
        {
          dateLocal: '2026-05-18',
          overallState: 'warn',
          title: null,
          shortSummary: null,
          axes: [{ key: 'clients', state: 'risk' }],
        },
      ],
    });
    const s = computeWeekVerdictSignals(p);
    expect(s.hasNegativeClientSignal).toBe(true);
  });

  it('tasksPlanned=10 tasksDone=3 → executionStrained=true', () => {
    const p = pkg({ team: emptyTeam({ tasksPlanned: 10, tasksDone: 3 }) });
    const s = computeWeekVerdictSignals(p);
    expect(s.executionStrained).toBe(true);
  });

  it('всё ок (нет clients risk, done/planned >= 0.5) → оба false', () => {
    const p = pkg({
      days: [
        {
          dateLocal: '2026-05-18',
          overallState: 'ok',
          title: null,
          shortSummary: null,
          axes: [{ key: 'clients', state: 'ok' }],
        },
      ],
      team: emptyTeam({ tasksPlanned: 10, tasksDone: 8 }),
    });
    const s = computeWeekVerdictSignals(p);
    expect(s.hasNegativeClientSignal).toBe(false);
    expect(s.executionStrained).toBe(false);
  });
});

describe('clampWeekVerdict', () => {
  it('clients ok + hasNegativeClientSignal → clients !== ok', () => {
    const v = verdict({ team: 'ok', clients: 'ok', execution: 'ok', overall: 'ok' });
    const out = clampWeekVerdict(v, {
      hasNegativeClientSignal: true,
      executionStrained: false,
    });
    expect(out.axes.find((a) => a.key === 'clients')!.state).not.toBe('ok');
    expect(out.axes.find((a) => a.key === 'clients')!.state).toBe('risk');
  });

  it('execution ok + executionStrained → execution !== ok', () => {
    const v = verdict({ team: 'ok', clients: 'ok', execution: 'ok', overall: 'ok' });
    const out = clampWeekVerdict(v, {
      hasNegativeClientSignal: false,
      executionStrained: true,
    });
    expect(out.axes.find((a) => a.key === 'execution')!.state).not.toBe('ok');
  });

  it('нет сигналов → вердикт не меняется, повторный clamp идемпотентен', () => {
    const v = verdict({ team: 'ok', clients: 'ok', execution: 'ok', overall: 'ok' });
    const noSignals = { hasNegativeClientSignal: false, executionStrained: false };
    const once = clampWeekVerdict(v, noSignals);
    expect(once).toEqual(v);
    const twice = clampWeekVerdict(once, noSignals);
    expect(twice).toEqual(once);
  });

  it('доменная risk → overall и ось overall поднимаются с ok до warn', () => {
    const v = verdict({ team: 'ok', clients: 'ok', execution: 'ok', overall: 'ok' });
    const out = clampWeekVerdict(v, {
      hasNegativeClientSignal: true,
      executionStrained: false,
    });
    expect(out.overall.state).toBe('warn');
    expect(out.axes.find((a) => a.key === 'overall')!.state).toBe('warn');
  });
});
