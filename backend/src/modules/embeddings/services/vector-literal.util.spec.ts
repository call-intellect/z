/**
 * G2 — guard размерности/чистоты pgvector-литерала на READ-пути.
 * Проверяем: валидный вектор → литерал как раньше; неверная длина → отказ
 * (literal=null); NaN/Infinity → отказ; пустой → отказ.
 */
import { describe, expect, it } from 'vitest';

import { buildVectorLiteral } from './vector-literal.util';

describe('buildVectorLiteral — G2 guard', () => {
  it('валидный вектор нужной размерности → литерал [v1,v2,...]', () => {
    const vec = new Array(1536).fill(0).map((_, i) => i / 1536);
    const res = buildVectorLiteral(vec, 1536);
    expect(res.rejectReason).toBeNull();
    expect(res.literal).toBe(`[${vec.join(',')}]`);
  });

  it('короткий вектор (3 при ожидании 1536) → отказ wrong_dimension', () => {
    const res = buildVectorLiteral([0.1, 0.2, 0.3], 1536);
    expect(res.literal).toBeNull();
    expect(res.rejectReason).toBe('wrong_dimension');
  });

  it('длиннее ожидаемого → отказ wrong_dimension', () => {
    const res = buildVectorLiteral([0.1, 0.2, 0.3, 0.4], 3);
    expect(res.literal).toBeNull();
    expect(res.rejectReason).toBe('wrong_dimension');
  });

  it('NaN в элементе → отказ non_finite', () => {
    const res = buildVectorLiteral([0.1, Number.NaN, 0.3], 3);
    expect(res.literal).toBeNull();
    expect(res.rejectReason).toBe('non_finite');
  });

  it('Infinity в элементе → отказ non_finite', () => {
    const res = buildVectorLiteral([0.1, Number.POSITIVE_INFINITY, 0.3], 3);
    expect(res.literal).toBeNull();
    expect(res.rejectReason).toBe('non_finite');
  });

  it('пустой / null / undefined → отказ empty', () => {
    expect(buildVectorLiteral([], 3).rejectReason).toBe('empty');
    expect(buildVectorLiteral(null, 3).rejectReason).toBe('empty');
    expect(buildVectorLiteral(undefined, 3).rejectReason).toBe('empty');
  });

  it('валидный короткий вектор при совпадающей размерности → литерал', () => {
    const res = buildVectorLiteral([0.1, 0.2, 0.3], 3);
    expect(res.rejectReason).toBeNull();
    expect(res.literal).toBe('[0.1,0.2,0.3]');
  });
});
