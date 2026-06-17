import { describe, expect, it } from 'vitest';

import { InvoiceNumberService } from './invoice-number.service';

describe('InvoiceNumberService.format', () => {
  const svc = new InvoiceNumberService();

  it('форматирует базовый случай Z-2026-000001', () => {
    expect(svc.format(1, new Date('2026-05-27T00:00:00Z'))).toBe('Z-2026-000001');
  });

  it('padding до 6 знаков', () => {
    expect(svc.format(42, new Date('2026-01-01T00:00:00Z'))).toBe('Z-2026-000042');
    expect(svc.format(123_456, new Date('2026-01-01T00:00:00Z'))).toBe('Z-2026-123456');
  });

  it('billingNumber >= 1_000_000 — естественное расширение padding', () => {
    expect(svc.format(1_234_567, new Date('2026-01-01T00:00:00Z'))).toBe('Z-2026-1234567');
  });

  it('берёт UTC-год (а не локальный)', () => {
    expect(svc.format(7, new Date('2026-12-31T23:00:00Z'))).toBe('Z-2026-000007');
    expect(svc.format(7, new Date('2027-01-01T00:00:00Z'))).toBe('Z-2027-000007');
  });

  it('default = текущий год (через new Date())', () => {
    const result = svc.format(99);
    const expectedYear = new Date().getUTCFullYear();
    expect(result).toBe(`Z-${expectedYear}-000099`);
  });

  it('throw при невалидном billingNumber', () => {
    expect(() => svc.format(0)).toThrow(/billingNumber/);
    expect(() => svc.format(-5)).toThrow(/billingNumber/);
    expect(() => svc.format(1.5)).toThrow(/billingNumber/);
    expect(() => svc.format(Number.NaN)).toThrow(/billingNumber/);
  });
});
