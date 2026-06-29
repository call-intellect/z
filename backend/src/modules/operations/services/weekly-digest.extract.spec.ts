import { describe, expect, it } from 'vitest';

import { extractWeekCompanyResponse } from './weekly-digest.service';

const VALID = {
  verdict: {
    overall: { state: 'warn', emoji: '⚠️', title: 'Неделя', oneLiner: 'итог' },
    axes: [
      { key: 'team', state: 'ok', label: 'l', why: 'w' },
      { key: 'clients', state: 'ok', label: 'l', why: 'w' },
      { key: 'execution', state: 'warn', label: 'l', why: 'w' },
      { key: 'overall', state: 'warn', label: 'l', why: 'w' },
    ],
  },
  letter: [{ key: 'main', title: 'Главное', prose: 'проза' }],
  goalAlignmentWeek: {
    direction: 'drift',
    score: 41,
    weekDelta: '+2 из 10',
    why: 'w',
    pro: [],
    contra: [],
  },
  risksSummary: 'r',
  ideasSummary: 'i',
};

describe('extractWeekCompanyResponse', () => {
  it('(a) валидный JSON-строкой в text → парсится', () => {
    const out = extractWeekCompanyResponse({ text: JSON.stringify(VALID) });
    expect(out).not.toBeNull();
    expect(out!.verdict.axes.length).toBeGreaterThanOrEqual(1);
  });

  it('(b) toolCalls [{ input: <объект> }] → парсится', () => {
    const out = extractWeekCompanyResponse({ text: '', toolCalls: [{ input: VALID }] });
    expect(out).not.toBeNull();
    expect(out!.verdict.axes.length).toBeGreaterThanOrEqual(1);
  });

  it('(c) обёртка { result: <объект> } строкой в text → парсится', () => {
    const out = extractWeekCompanyResponse({ text: JSON.stringify({ result: VALID }) });
    expect(out).not.toBeNull();
    expect(out!.verdict.axes.length).toBeGreaterThanOrEqual(1);
  });

  it('(d) мусор без toolCalls → null', () => {
    const out = extractWeekCompanyResponse({ text: 'не json' });
    expect(out).toBeNull();
  });
});
