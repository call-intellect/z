import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

type Sig = { entity?: string; phrases: string[] };
type GoldQ = {
  id: string;
  angle: string;
  question: string;
  expectedKind: 'answerable' | 'honest_empty';
  expectedEntities: string[];
  mustMention: string[];
  expectedBlockSignatures: Sig[];
  chain?: string;
  turn?: number;
};

const gold = JSON.parse(readFileSync(join(__dirname, 'recall-gold.json'), 'utf8')) as {
  _meta: Record<string, unknown>;
  questions: GoldQ[];
};
const qs = gold.questions;

describe('recall-gold · загрузка и мета', () => {
  it('набор загружается и непустой', () => {
    expect(Array.isArray(qs)).toBe(true);
    expect(qs.length).toBeGreaterThanOrEqual(40);
    expect(qs.length).toBeLessThanOrEqual(60);
  });

  it('_meta.count совпадает с фактическим числом вопросов', () => {
    expect(gold._meta.count).toBe(qs.length);
  });
});

describe('recall-gold · целостность записей', () => {
  it('id уникальны и в формате qNNN', () => {
    const ids = qs.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^q\d+[a-z]?$/);
  });

  it('у каждого вопроса непустой текст, angle и валидный expectedKind', () => {
    for (const q of qs) {
      expect(q.question.trim().length).toBeGreaterThan(0);
      expect(q.angle.trim().length).toBeGreaterThan(0);
      expect(['answerable', 'honest_empty']).toContain(q.expectedKind);
    }
  });
});

describe('recall-gold · answerable заземлён', () => {
  const answerable = qs.filter((q) => q.expectedKind === 'answerable');

  it('answerable-вопросов достаточно (≥30)', () => {
    expect(answerable.length).toBeGreaterThanOrEqual(30);
  });

  it('каждый answerable имеет ≥1 сигнатуру с непустыми phrases и непустой mustMention', () => {
    for (const q of answerable) {
      expect(q.expectedBlockSignatures.length, `${q.id}: нет сигнатур`).toBeGreaterThanOrEqual(1);
      for (const sig of q.expectedBlockSignatures) {
        expect(Array.isArray(sig.phrases), `${q.id}: sig.phrases не массив`).toBe(true);
        expect(sig.phrases.length, `${q.id}: пустой phrases`).toBeGreaterThanOrEqual(1);
        for (const p of sig.phrases) expect(p.trim().length).toBeGreaterThan(0);
      }
      expect(q.mustMention.length, `${q.id}: пустой mustMention`).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('recall-gold · honest_empty пуст', () => {
  const empties = qs.filter((q) => q.expectedKind === 'honest_empty');

  it('honest_empty-вопросов достаточно (≥3)', () => {
    expect(empties.length).toBeGreaterThanOrEqual(3);
  });

  it('honest_empty не несёт заземления (нет сущностей/сигнатур/mustMention)', () => {
    for (const q of empties) {
      expect(q.expectedEntities.length, `${q.id}: honest_empty с сущностями`).toBe(0);
      expect(q.expectedBlockSignatures.length, `${q.id}: honest_empty с сигнатурами`).toBe(0);
      expect(q.mustMention.length, `${q.id}: honest_empty с mustMention`).toBe(0);
    }
  });
});

describe('recall-gold · цепочки диалога', () => {
  it('chain и turn присутствуют вместе; turn — целое ≥1', () => {
    for (const q of qs) {
      const hasChain = q.chain !== undefined && q.chain !== null;
      const hasTurn = q.turn !== undefined && q.turn !== null;
      expect(hasChain, `${q.id}: chain без turn или наоборот`).toBe(hasTurn);
      if (hasTurn) {
        expect(Number.isInteger(q.turn)).toBe(true);
        expect(q.turn as number).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('каждая цепочка имеет ≥2 хода, turns образуют 1..N без пропусков и дублей', () => {
    const byChain = new Map<string, number[]>();
    for (const q of qs) if (q.chain) (byChain.get(q.chain) ?? byChain.set(q.chain, []).get(q.chain)!).push(q.turn as number);
    expect(byChain.size).toBeGreaterThanOrEqual(1);
    for (const [chain, turns] of byChain) {
      expect(turns.length, `${chain}: одиночный ход`).toBeGreaterThanOrEqual(2);
      const sorted = [...turns].sort((a, b) => a - b);
      expect(new Set(sorted).size, `${chain}: дубли turn`).toBe(sorted.length);
      for (let i = 0; i < sorted.length; i++) expect(sorted[i], `${chain}: пропуск в turn`).toBe(i + 1);
    }
  });

  it('follow-up-образный вопрос («А …», «И …») не идёт одиночкой без chain', () => {
    for (const q of qs) {
      if (/^(А|И)\s/.test(q.question)) expect(q.chain, `${q.id}: follow-up без chain`).toBeTruthy();
    }
  });
});
