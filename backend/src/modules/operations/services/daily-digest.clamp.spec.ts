import { describe, expect, it } from 'vitest';

import type { DailyDigestVerdictDto } from '../dto/daily-digest.dto';
import type { DayCompanyPackage } from '../prompts/daily-digest.prompt';

import {
  clampVerdict,
  computeVerdictSignals,
  extractDayCompanyResponse,
  type DayVerdictSignals,
} from './daily-digest.service';

function validContract() {
  return {
    verdict: {
      overall: { state: 'risk', emoji: '🔴', title: 'Тяжёлый день', oneLiner: 'Клиент молчит.' },
      axes: [
        { key: 'team', state: 'warn', label: 'Перегруз', why: 'Айназ в красной зоне' },
        { key: 'clients', state: 'risk', label: 'Риск', why: 'Молочные реки молчат' },
        { key: 'execution', state: 'warn', label: 'Буксует', why: 'Блокер 6 дней' },
        { key: 'overall', state: 'risk', label: 'Критично', why: '1 красная зона' },
      ],
    },
    letter: [{ key: 'main', title: 'Главное за день', prose: 'Текст письма.' }],
    goalAlignmentDay: {
      direction: 'drift',
      score: 46,
      todayDelta: '+0 из 10',
      why: 'Активность мимо цели.',
      pro: ['согласован подрядчик'],
      contra: ['блокер не снят'],
    },
    risksSummary: 'Клиент без ответа.',
    ideasSummary: 'Растёт спрос на онбординг.',
  };
}

function baseVerdict(overrides?: {
  clients?: 'ok' | 'warn' | 'risk';
  execution?: 'ok' | 'warn' | 'risk';
  team?: 'ok' | 'warn' | 'risk';
  overall?: 'ok' | 'warn' | 'risk';
}): DailyDigestVerdictDto {
  return {
    overall: {
      state: overrides?.overall ?? 'ok',
      emoji: '🟢',
      title: 'Спокойный день',
      oneLiner: 'Всё в норме.',
    },
    axes: [
      { key: 'team', state: overrides?.team ?? 'ok', label: 'Норма', why: '—' },
      { key: 'clients', state: overrides?.clients ?? 'ok', label: 'Норма', why: '—' },
      { key: 'execution', state: overrides?.execution ?? 'ok', label: 'Норма', why: '—' },
      { key: 'overall', state: overrides?.overall ?? 'ok', label: 'Норма', why: '—' },
    ],
  };
}

function noSignals(): DayVerdictSignals {
  return { hasNegativeClientSignal: false, executionStrained: false };
}

function emptyPackage(overrides?: Partial<DayCompanyPackage>): DayCompanyPackage {
  return {
    dateLocal: '2026-06-28',
    goalId: null,
    goalName: null,
    meetings: [],
    topInsights: [],
    topIdeas: [],
    customersAtRisk: [],
    compass: null,
    yesterday: null,
    ...overrides,
  };
}

function emptyMetrics() {
  return {
    totalCheckIns: 0,
    greenShare: 0,
    yellowShare: 0,
    redShare: 0,
    topRedCheckIns: [],
    newBlockers: [],
    overdueCommitments: [],
    goals: { completed: 0, failed: 0, activated: 0, completedIds: [], failedIds: [] },
    newHighInsights: [],
    decisions: [],
  };
}

describe('clampVerdict (R4)', () => {
  it('негатив: клиентский сигнал + clients=ok ⇒ clients ≠ ok (risk)', () => {
    const verdict = baseVerdict({ clients: 'ok' });
    const out = clampVerdict(verdict, {
      hasNegativeClientSignal: true,
      executionStrained: false,
    });
    const clients = out.axes.find((a) => a.key === 'clients')!;
    expect(clients.state).not.toBe('ok');
    expect(clients.state).toBe('risk');
  });

  it('позитив-инвариант: без клиентского сигнала ось clients не меняется', () => {
    const verdict = baseVerdict({ clients: 'ok' });
    const out = clampVerdict(verdict, noSignals());
    expect(out.axes.find((a) => a.key === 'clients')!.state).toBe('ok');
  });

  it('execution: executionStrained + execution=ok ⇒ execution ≠ ok (warn)', () => {
    const verdict = baseVerdict({ execution: 'ok' });
    const out = clampVerdict(verdict, {
      hasNegativeClientSignal: false,
      executionStrained: true,
    });
    const execution = out.axes.find((a) => a.key === 'execution')!;
    expect(execution.state).not.toBe('ok');
    expect(execution.state).toBe('warn');
  });

  it('overall-инвариант: любая ось risk + overall=ok ⇒ overall ≠ ok', () => {
    const verdict = baseVerdict({ clients: 'ok', overall: 'ok' });
    const out = clampVerdict(verdict, {
      hasNegativeClientSignal: true,
      executionStrained: false,
    });
    expect(out.overall.state).not.toBe('ok');
    expect(out.axes.find((a) => a.key === 'overall')!.state).not.toBe('ok');
  });

  it('иммутабельность: вход не мутирован', () => {
    const verdict = baseVerdict({ clients: 'ok', overall: 'ok' });
    const snapshot = JSON.stringify(verdict);
    clampVerdict(verdict, { hasNegativeClientSignal: true, executionStrained: true });
    expect(JSON.stringify(verdict)).toBe(snapshot);
  });
});

describe('computeVerdictSignals', () => {
  it('критический клиент ⇒ hasNegativeClientSignal=true', () => {
    const signals = computeVerdictSignals(
      emptyMetrics(),
      emptyPackage({
        customersAtRisk: [{ customerName: 'Acme', riskLevel: 'critical', signals: 'отток ×2' }],
      }),
      5,
    );
    expect(signals.hasNegativeClientSignal).toBe(true);
  });

  it('high/critical insight ⇒ hasNegativeClientSignal=true', () => {
    const signals = computeVerdictSignals(
      emptyMetrics(),
      emptyPackage({
        topInsights: [{ id: 'i1', statement: 's', severity: 'high', kind: 'risk' }],
      }),
      5,
    );
    expect(signals.hasNegativeClientSignal).toBe(true);
  });

  it('блокер confidence≥0.8 ⇒ executionStrained=true', () => {
    const metrics = { ...emptyMetrics(), newBlockers: [{ blockId: 'b1', name: 'b', confidence: 0.9 }] };
    const signals = computeVerdictSignals(metrics, emptyPackage(), 5);
    expect(signals.executionStrained).toBe(true);
  });

  it('просрочка старше порога ⇒ executionStrained=true', () => {
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const metrics = {
      ...emptyMetrics(),
      overdueCommitments: [
        { blockId: 'c1', name: 'c', dueDate: old, recipientPersonId: null },
      ],
    };
    const signals = computeVerdictSignals(metrics, emptyPackage(), 5);
    expect(signals.executionStrained).toBe(true);
  });

  it('пусто ⇒ оба сигнала false', () => {
    const signals = computeVerdictSignals(emptyMetrics(), emptyPackage(), 5);
    expect(signals.hasNegativeClientSignal).toBe(false);
    expect(signals.executionStrained).toBe(false);
  });
});

describe('extractDayCompanyResponse', () => {
  it('toolCalls + обёртка {result} (поведение deepseek-v4-pro) ⇒ распарсено', () => {
    const out = extractDayCompanyResponse({
      text: 'рассуждение модели без чистого JSON',
      toolCalls: [{ input: { result: validContract() } }],
    });
    expect(out).not.toBeNull();
    expect(out!.verdict.axes.find((a) => a.key === 'clients')!.state).toBe('risk');
    expect(out!.letter).toHaveLength(1);
  });

  it('обёртка {result} в text ⇒ распарсено', () => {
    const out = extractDayCompanyResponse({ text: JSON.stringify({ result: validContract() }) });
    expect(out).not.toBeNull();
    expect(out!.goalAlignmentDay.score).toBe(46);
  });

  it('чистый контракт верхнего уровня в text ⇒ распарсено', () => {
    const out = extractDayCompanyResponse({ text: JSON.stringify(validContract()) });
    expect(out).not.toBeNull();
    expect(out!.risksSummary).toContain('без ответа');
  });

  it('обёртка {data} в toolCalls ⇒ распарсено', () => {
    const out = extractDayCompanyResponse({ text: '', toolCalls: [{ input: { data: validContract() } }] });
    expect(out).not.toBeNull();
  });

  it('мусор без JSON ⇒ null (срабатывает сухой fallback)', () => {
    const out = extractDayCompanyResponse({ text: 'это не json' });
    expect(out).toBeNull();
  });

  it('невалидная структура (нет letter) ⇒ null', () => {
    const broken = { ...validContract(), letter: undefined };
    const out = extractDayCompanyResponse({ text: JSON.stringify(broken) });
    expect(out).toBeNull();
  });
});
