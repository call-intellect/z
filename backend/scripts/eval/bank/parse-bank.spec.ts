import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isFollowUpShaped, splitBank, totalToRun, validateBank, type BankItem } from './parse-bank';

const realBank = JSON.parse(
  readFileSync(join(__dirname, '../../../../docs/testing/strela-recall-questions.json'), 'utf8'),
) as BankItem[];

describe('splitBank · разбор одиночек и цепочек', () => {
  const bank: BankItem[] = [
    { id: 's1', question: 'Что решили?' },
    { id: 's2', question: 'Кто отвечает?' },
    { id: 'c1t2', question: 'А потом?', chain: 'c1', turn: 2 },
    { id: 'c1t1', question: 'Что с пилотом?', chain: 'c1', turn: 1 },
    { id: 'c2t1', question: 'Что с Битрикс?', chain: 'c2', turn: 1 },
    { id: 'c2t2', question: 'А почему?', chain: 'c2', turn: 2 },
  ];

  it('одиночки без chain; цепочки сгруппированы и отсортированы по turn', () => {
    const { singles, chains } = splitBank(bank);
    expect(singles.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(chains.length).toBe(2);
    const c1 = chains.find((c) => c[0].chain === 'c1')!;
    expect(c1.map((x) => x.id)).toEqual(['c1t1', 'c1t2']);
    expect(c1.map((x) => x.turn)).toEqual([1, 2]);
  });

  it('LIMIT режет одиночки, но цепочки прогоняются ВСЕГДА (фикс гейта LIMIT===∞)', () => {
    const { singles, chains } = splitBank(bank, 1);
    expect(singles.map((s) => s.id)).toEqual(['s1']);
    expect(chains.length).toBe(2);
    expect(totalToRun({ singles, chains })).toBe(1 + 4);
  });
});

describe('isFollowUpShaped', () => {
  it('«А …» / «И …» / голое местоимение = follow-up', () => {
    expect(isFollowUpShaped('А кто за него отвечает?')).toBe(true);
    expect(isFollowUpShaped('И на что она влияет?')).toBe(true);
    expect(isFollowUpShaped('Это важнее выручки?')).toBe(true);
  });

  it('полноценные вопросы (в т.ч. «Идём…», «Игорь…») НЕ follow-up', () => {
    expect(isFollowUpShaped('Идём ли мы к цели по retention?')).toBe(false);
    expect(isFollowUpShaped('Что решили по LiveKit?')).toBe(false);
    expect(isFollowUpShaped('Кто отвечает за дизайн?')).toBe(false);
    expect(isFollowUpShaped('Именно поэтому важно?')).toBe(false);
  });
});

describe('validateBank · ловит битый банк', () => {
  it('follow-up-образный одиночка без chain → ошибка', () => {
    const errs = validateBank([{ id: 'x', question: 'А что дальше?' }]);
    expect(errs.some((e) => e.id === 'x' && /без chain/.test(e.problem))).toBe(true);
  });

  it('цепочка из одного хода → ошибка', () => {
    const errs = validateBank([{ id: 'c1t1', question: 'Что?', chain: 'c1', turn: 1 }]);
    expect(errs.some((e) => e.id === 'c1' && /одного хода/.test(e.problem))).toBe(true);
  });

  it('turn с пропуском (1,3) → ошибка «не образуют 1..N»', () => {
    const errs = validateBank([
      { id: 'a', question: 'Q1', chain: 'c', turn: 1 },
      { id: 'b', question: 'Q3', chain: 'c', turn: 3 },
    ]);
    expect(errs.some((e) => /1\.\.N/.test(e.problem))).toBe(true);
  });

  it('chain без turn → ошибка', () => {
    const errs = validateBank([
      { id: 'a', question: 'Q1', chain: 'c', turn: 1 },
      { id: 'b', question: 'Q2', chain: 'c' },
    ]);
    expect(errs.some((e) => e.id === 'b' && /без корректного turn/.test(e.problem))).toBe(true);
  });
});

describe('validateBank · реальный банк-111 валиден', () => {
  it('в docs/testing/strela-recall-questions.json нет нарушений (все «А…/И…» с chain)', () => {
    const errs = validateBank(realBank);
    expect(errs, JSON.stringify(errs)).toEqual([]);
  });

  it('реальный банк: 4 цепочки, остальное — одиночки', () => {
    const { singles, chains } = splitBank(realBank);
    expect(chains.length).toBe(4);
    expect(singles.length + chains.reduce((n, c) => n + c.length, 0)).toBe(realBank.length);
  });
});
