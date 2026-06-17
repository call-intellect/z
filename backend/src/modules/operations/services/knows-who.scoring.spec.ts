import { describe, expect, it } from 'vitest';

import {
  DEFAULT_KNOWS_WHO_MIN_CONFIDENCE,
  rankExperts,
  type KnowsWhoRow,
} from './knows-who.scoring';

describe('knows-who.scoring rankExperts', () => {
  const rows = (over: Partial<KnowsWhoRow>[]): KnowsWhoRow[] =>
    over.map((o, i) => ({
      personId: o.personId ?? `p${i}`,
      categoryName: o.categoryName ?? `cat${i}`,
      confidence: o.confidence ?? 'medium',
      similarity: o.similarity ?? 0.7,
    }));

  it('исключает автора блокера из результата', () => {
    const out = rankExperts({
      rows: rows([
        { personId: 'author', similarity: 0.95, confidence: 'high' },
        { personId: 'expert', similarity: 0.8, confidence: 'high' },
      ]),
      excludePersonId: 'author',
    });
    expect(out.map((c) => c.personId)).toEqual(['expert']);
  });

  it('кандидат ниже порога confidence (bestSimilarity) отбраковывается', () => {
    const out = rankExperts({
      rows: rows([
        { personId: 'low', similarity: 0.3, confidence: 'high' },
        { personId: 'ok', similarity: 0.6, confidence: 'low' },
      ]),
      minConfidence: 0.5,
    });
    expect(out.map((c) => c.personId)).toEqual(['ok']);
  });

  it('агрегирует score по personId (сумма similarity*вес)', () => {
    const out = rankExperts({
      rows: rows([
        { personId: 'p1', categoryName: 'a', similarity: 0.6, confidence: 'low' },
        { personId: 'p1', categoryName: 'b', similarity: 0.7, confidence: 'low' },
        { personId: 'p2', categoryName: 'c', similarity: 0.65, confidence: 'low' },
      ]),
      minConfidence: 0.5,
    });
    expect(out[0]!.personId).toBe('p1');
    expect(out[0]!.score).toBeCloseTo(1.3, 4);
  });

  it('confidence-вес влияет на ранжирование (high весомее low)', () => {
    const out = rankExperts({
      rows: rows([
        { personId: 'high', similarity: 0.6, confidence: 'high' },
        { personId: 'low', similarity: 0.7, confidence: 'low' },
      ]),
      minConfidence: 0.5,
    });
    expect(out[0]!.personId).toBe('high');
  });

  it('топ-K ограничивает выдачу', () => {
    const out = rankExperts({
      rows: rows([
        { personId: 'p1', similarity: 0.9 },
        { personId: 'p2', similarity: 0.8 },
        { personId: 'p3', similarity: 0.7 },
        { personId: 'p4', similarity: 0.6 },
      ]),
      minConfidence: 0.5,
      topK: 2,
    });
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.personId)).toEqual(['p1', 'p2']);
  });

  it('негатив: мусорный similarity (NaN/<0/>1) санитизируется в [0..1]', () => {
    const out = rankExperts({
      rows: [
        { personId: 'nan', categoryName: 'a', confidence: 'high', similarity: Number.NaN },
        { personId: 'neg', categoryName: 'b', confidence: 'high', similarity: -5 },
        { personId: 'big', categoryName: 'c', confidence: 'high', similarity: 9 },
      ],
      minConfidence: 0.5,
    });
    expect(out.map((c) => c.personId)).toEqual(['big']);
    expect(out[0]!.bestSimilarity).toBe(1);
  });

  it('негатив: мусорный confidence трактуется как low', () => {
    const out = rankExperts({
      rows: [{ personId: 'p', categoryName: 'a', confidence: 'garbage', similarity: 0.6 }],
      minConfidence: 0.5,
    });
    expect(out[0]!.topCategories[0]!.confidence).toBe('low');
    expect(out[0]!.score).toBeCloseTo(0.6, 4);
  });

  it('пустой ввод → пустой результат', () => {
    expect(rankExperts({ rows: [] })).toEqual([]);
  });

  it('дефолтный порог берётся, если minConfidence не задан', () => {
    const justBelow = rankExperts({
      rows: rows([{ personId: 'x', similarity: DEFAULT_KNOWS_WHO_MIN_CONFIDENCE - 0.01 }]),
    });
    const atThreshold = rankExperts({
      rows: rows([{ personId: 'x', similarity: DEFAULT_KNOWS_WHO_MIN_CONFIDENCE }]),
    });
    expect(justBelow).toHaveLength(0);
    expect(atThreshold).toHaveLength(1);
  });
});
