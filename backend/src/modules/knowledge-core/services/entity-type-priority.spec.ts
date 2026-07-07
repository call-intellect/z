import { describe, expect, it } from 'vitest';

import {
  normalizeEntityType,
  resolveCanonicalType,
} from './entity-type-priority';

describe('resolveCanonicalType', () => {
  it('normalizeEntityType: client → customer', () => {
    expect(normalizeEntityType('client')).toBe('customer');
    expect(normalizeEntityType('vendor')).toBe('vendor');
  });

  it('client нормализуется в customer до сравнения', () => {
    expect(resolveCanonicalType('client', 'customer')).toEqual({
      type: 'customer',
    });
    expect(resolveCanonicalType('customer', 'client')).toEqual({
      type: 'customer',
    });
  });

  it('равные типы возвращают тот же тип', () => {
    expect(resolveCanonicalType('vendor', 'vendor')).toEqual({
      type: 'vendor',
    });
    expect(resolveCanonicalType('topic', 'topic')).toEqual({ type: 'topic' });
  });

  it('domain приоритетнее generic (ровно один generic)', () => {
    expect(resolveCanonicalType('technology', 'topic')).toEqual({
      type: 'technology',
    });
    expect(resolveCanonicalType('metric', 'customer')).toEqual({
      type: 'customer',
    });
    expect(resolveCanonicalType('custom', 'goal')).toEqual({ type: 'goal' });
  });

  it('оба generic: metric > topic > custom', () => {
    expect(resolveCanonicalType('metric', 'topic')).toEqual({ type: 'metric' });
    expect(resolveCanonicalType('topic', 'metric')).toEqual({ type: 'metric' });
    expect(resolveCanonicalType('topic', 'custom')).toEqual({ type: 'topic' });
    expect(resolveCanonicalType('custom', 'metric')).toEqual({
      type: 'metric',
    });
  });

  it('оба domain и разные → disputed (решает арбитр)', () => {
    expect(resolveCanonicalType('customer', 'vendor')).toEqual({
      disputed: true,
    });
    expect(resolveCanonicalType('technology', 'product')).toEqual({
      disputed: true,
    });
    expect(resolveCanonicalType('project', 'product')).toEqual({
      disputed: true,
    });
  });

  it('person обрабатывается корректно в матрице', () => {
    expect(resolveCanonicalType('person', 'person')).toEqual({
      type: 'person',
    });
    expect(resolveCanonicalType('person', 'topic')).toEqual({
      type: 'person',
    });
    expect(resolveCanonicalType('person', 'customer')).toEqual({
      disputed: true,
    });
  });
});
