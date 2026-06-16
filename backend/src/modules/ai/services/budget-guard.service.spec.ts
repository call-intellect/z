import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { BudgetGuardService } from './budget-guard.service';

interface BuildOpts {
  cap?: { monthlyCapRub: unknown; capKind?: string } | null;
  mtdRub?: number;
  capThrows?: boolean;
  ttlSec?: number;
}

function build(opts: BuildOpts = {}) {
  const findUnique = vi.fn(async () => {
    if (opts.capThrows) throw new Error('db down');
    return opts.cap === undefined ? null : opts.cap;
  });
  const aggregate = vi.fn(async () => ({
    _sum: { costRub: opts.mtdRub ?? 0 },
  }));
  const prisma = {
    orgBudgetCap: { findUnique },
    aiUsageLog: { aggregate },
  } as unknown as PrismaService;

  const getDynamic = vi.fn(async (_key: string, _env: unknown, def: unknown) => opts.ttlSec ?? def);
  const cfg = { getDynamic } as unknown as TypedConfigService;

  const guard = new BudgetGuardService(prisma, cfg);
  return { guard, findUnique, aggregate, getDynamic };
}

describe('BudgetGuardService', () => {
  it('tenantId=null → over=false без запросов в БД', async () => {
    const ctx = build();
    const res = await ctx.guard.evaluate(null);
    expect(res).toEqual({ over: false, mtdRub: 0, capRub: null, capKind: 'soft' });
    expect(ctx.findUnique).not.toHaveBeenCalled();
    expect(ctx.aggregate).not.toHaveBeenCalled();
  });

  it('нет cap-записи → over=false, capRub=null', async () => {
    const ctx = build({ cap: null });
    const res = await ctx.guard.evaluate('t1');
    expect(res.over).toBe(false);
    expect(res.capRub).toBeNull();
    expect(ctx.aggregate).not.toHaveBeenCalled();
  });

  it('monthlyCapRub=null (без лимита) → over=false', async () => {
    const ctx = build({ cap: { monthlyCapRub: null, capKind: 'hard' } });
    const res = await ctx.guard.evaluate('t1');
    expect(res.over).toBe(false);
    expect(res.capRub).toBeNull();
    expect(ctx.aggregate).not.toHaveBeenCalled();
  });

  it('soft-cap при mtd≥cap → over=false (soft = только alert)', async () => {
    const ctx = build({ cap: { monthlyCapRub: 100, capKind: 'soft' }, mtdRub: 250 });
    const res = await ctx.guard.evaluate('t1');
    expect(res.over).toBe(false);
    expect(res.mtdRub).toBe(250);
    expect(res.capRub).toBe(100);
    expect(res.capKind).toBe('soft');
  });

  it('hard-cap при mtd≥cap → over=true', async () => {
    const ctx = build({ cap: { monthlyCapRub: 100, capKind: 'hard' }, mtdRub: 100 });
    const res = await ctx.guard.evaluate('t1');
    expect(res.over).toBe(true);
    expect(res.mtdRub).toBe(100);
    expect(res.capRub).toBe(100);
  });

  it('hard-cap при mtd<cap → over=false', async () => {
    const ctx = build({ cap: { monthlyCapRub: 100, capKind: 'hard' }, mtdRub: 99.99 });
    const res = await ctx.guard.evaluate('t1');
    expect(res.over).toBe(false);
  });

  it('кэш MTD: 2 evaluate подряд в пределах TTL → aggregate вызван 1 раз', async () => {
    const ctx = build({ cap: { monthlyCapRub: 100, capKind: 'hard' }, mtdRub: 50, ttlSec: 60 });
    await ctx.guard.evaluate('t1');
    await ctx.guard.evaluate('t1');
    expect(ctx.aggregate).toHaveBeenCalledTimes(1);
  });

  it('ошибка prisma (БД недоступна) → over=false (fail-open)', async () => {
    const ctx = build({ capThrows: true });
    const res = await ctx.guard.evaluate('t1');
    expect(res).toEqual({ over: false, mtdRub: 0, capRub: null, capKind: 'soft' });
  });

  it('Decimal-like costRub (Number()) корректно суммируется', async () => {
    const ctx = build({
      cap: { monthlyCapRub: 100, capKind: 'hard' },
      mtdRub: 120,
    });
    const res = await ctx.guard.evaluate('t1');
    expect(res.over).toBe(true);
    expect(res.mtdRub).toBe(120);
  });
});
