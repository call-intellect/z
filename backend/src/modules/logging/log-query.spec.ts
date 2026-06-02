import { describe, expect, it } from 'vitest';

import {
  buildLogWhere,
  expandLevelAtLeast,
  type LogQueryFilters,
} from './log.service';

const base: LogQueryFilters = { limit: 50, offset: 0 };

describe('expandLevelAtLeast', () => {
  it('WARN → WARN/ERROR/FATAL', () => {
    expect(expandLevelAtLeast('WARN')).toEqual(['WARN', 'ERROR', 'FATAL']);
  });
  it('DEBUG → все уровни', () => {
    expect(expandLevelAtLeast('DEBUG')).toEqual(['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']);
  });
  it('FATAL → только FATAL', () => {
    expect(expandLevelAtLeast('FATAL')).toEqual(['FATAL']);
  });
});

describe('buildLogWhere', () => {
  it('точный level имеет приоритет над levelAtLeast', () => {
    const w = buildLogWhere({ ...base, level: 'ERROR', levelAtLeast: 'INFO' });
    expect(w.level).toBe('ERROR');
  });

  it('levelAtLeast разворачивается в in[]', () => {
    const w = buildLogWhere({ ...base, levelAtLeast: 'WARN' });
    expect(w.level).toEqual({ in: ['WARN', 'ERROR', 'FATAL'] });
  });

  it('path → ILIKE contains', () => {
    const w = buildLogWhere({ ...base, path: '/api/v1/x' });
    expect(w.path).toEqual({ contains: '/api/v1/x', mode: 'insensitive' });
  });

  it('search → OR по message/errorMessage/action', () => {
    const w = buildLogWhere({ ...base, search: 'boom' });
    expect(Array.isArray(w.OR)).toBe(true);
    expect(w.OR).toHaveLength(3);
  });

  it('search без периода → окно 30 дней (createdAt.gte)', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    const w = buildLogWhere({ ...base, search: 'x' }, now);
    const gte = (w.createdAt as { gte?: Date }).gte;
    expect(gte).toBeInstanceOf(Date);
    expect(now.getTime() - (gte as Date).getTime()).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('явный период переопределяет окно поиска', () => {
    const from = new Date('2026-05-01T00:00:00.000Z');
    const to = new Date('2026-05-10T00:00:00.000Z');
    const w = buildLogWhere({ ...base, search: 'x', dateFrom: from, dateTo: to });
    expect(w.createdAt).toEqual({ gte: from, lt: to });
  });

  it('простые равенства', () => {
    const w = buildLogWhere({
      ...base,
      category: 'AUTH',
      contour: 'SUPERADMIN',
      module: 'http',
      userId: 'u1',
      orgId: 'o1',
      requestId: 'r1',
      method: 'POST',
      statusCode: 500,
    });
    expect(w.category).toBe('AUTH');
    expect(w.contour).toBe('SUPERADMIN');
    expect(w.module).toBe('http');
    expect(w.userId).toBe('u1');
    expect(w.orgId).toBe('o1');
    expect(w.requestId).toBe('r1');
    expect(w.method).toBe('POST');
    expect(w.statusCode).toBe(500);
  });
});
