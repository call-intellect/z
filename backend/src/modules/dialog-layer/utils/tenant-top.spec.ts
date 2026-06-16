import { describe, expect, it } from 'vitest';

import { tenantTopOf } from './tenant-top';

describe('tenantTopOf', () => {
  it('null → system', () => {
    expect(tenantTopOf(null)).toBe('system');
    expect(tenantTopOf(undefined)).toBe('system');
    expect(tenantTopOf('')).toBe('system');
  });

  it('стабильный bucket-id для одного tenantId', () => {
    const a = tenantTopOf('tenant-uuid-1');
    const b = tenantTopOf('tenant-uuid-1');
    expect(a).toBe(b);
    expect(a).toMatch(/^t\d{3}$/);
  });

  it('разные tenantId — разные buckets (с высокой вероятностью)', () => {
    const buckets = new Set<string>();
    for (let i = 0; i < 50; i++) {
      buckets.add(tenantTopOf(`tenant-${i}`));
    }
    expect(buckets.size).toBeGreaterThanOrEqual(30);
  });

  it('cardinality ≤ 100 + system', () => {
    const buckets = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      buckets.add(tenantTopOf(`tenant-${i}`));
    }
    expect(buckets.size).toBeLessThanOrEqual(100);
  });
});
