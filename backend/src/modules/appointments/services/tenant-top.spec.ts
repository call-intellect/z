import { describe, expect, it } from 'vitest';

import { resolveAppointmentStatus, resolveAppointmentTenantTop } from './tenant-top';

describe('resolveAppointmentTenantTop', () => {
  it('пустая строка → "other"', () => {
    expect(resolveAppointmentTenantTop('')).toBe('other');
  });

  it('возвращает стабильный t<bucket> для одного и того же tenantId', () => {
    const a = resolveAppointmentTenantTop('org_abc123');
    const b = resolveAppointmentTenantTop('org_abc123');
    expect(a).toBe(b);
    expect(a).toMatch(/^t\d+$/);
  });

  it('bucket-номера в диапазоне 0..99 (cardinality cap)', () => {
    const t = resolveAppointmentTenantTop('org_test');
    const n = Number.parseInt(t.slice(1), 10);
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThan(100);
  });
});

describe('resolveAppointmentStatus', () => {
  const NOW = new Date('2026-05-23T12:00:00Z').getTime();

  it('validTo IS NULL → active', () => {
    expect(resolveAppointmentStatus(null, NOW)).toBe('active');
  });

  it('validTo в прошлом → former (PersonRole с уже закрытой ролью)', () => {
    const past = new Date('2025-01-01T00:00:00Z');
    expect(resolveAppointmentStatus(past, NOW)).toBe('former');
  });

  it('validTo в будущем → active (запланированное завершение)', () => {
    const future = new Date('2027-01-01T00:00:00Z');
    expect(resolveAppointmentStatus(future, NOW)).toBe('active');
  });

  it('значение по умолчанию now=Date.now() — не падает', () => {
    expect(() => resolveAppointmentStatus(null)).not.toThrow();
  });
});
