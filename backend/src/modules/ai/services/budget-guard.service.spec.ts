import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { CurrencyRateService } from '../../admin/economics/currency-rate.service';

import { BudgetGuardService } from './budget-guard.service';

interface BuildOpts {
  cap?: { monthlyCapRub: unknown; capKind?: string } | null;
  mtdRub?: number;
  capThrows?: boolean;
  ttlSec?: number;
  fxRate?: number;
  defaultCapRub?: number;
}

function build(opts: BuildOpts = {}) {
  const findUnique = vi.fn(async () => {
    if (opts.capThrows) throw new Error('db down');
    return opts.cap === undefined ? null : opts.cap;
  });
  const queryRaw = vi.fn(async () => [{ total_rub: String(opts.mtdRub ?? 0) }]);
  const prisma = {
    orgBudgetCap: { findUnique },
    $queryRaw: queryRaw,
  } as unknown as PrismaService;

  const getDynamic = vi.fn(async (key: string, _env: unknown, def: unknown) => {
    if (key === 'llm.budget.default_monthly_cap_rub') {
      return opts.defaultCapRub ?? def;
    }
    return opts.ttlSec ?? def;
  });
  const cfg = { getDynamic } as unknown as TypedConfigService;

  const currencyRate = {
    getCurrentUsdRubRate: vi.fn(async () => opts.fxRate ?? 90),
  } as unknown as CurrencyRateService;

  const guard = new BudgetGuardService(prisma, cfg, currencyRate);
  return { guard, findUnique, queryRaw, getDynamic, currencyRate };
}

describe('BudgetGuardService', () => {
  it('tenantId=null → over=false без запросов в БД', async () => {
    const ctx = build();
    const res = await ctx.guard.evaluate(null);
    expect(res).toEqual({ over: false, mtdRub: 0, capRub: null, capKind: 'soft' });
    expect(ctx.findUnique).not.toHaveBeenCalled();
    expect(ctx.queryRaw).not.toHaveBeenCalled();
  });

  it('нет cap-записи → over=false, capRub=null', async () => {
    const ctx = build({ cap: null });
    const res = await ctx.guard.evaluate('t1');
    expect(res.over).toBe(false);
    expect(res.capRub).toBeNull();
    expect(ctx.queryRaw).not.toHaveBeenCalled();
  });

  it('monthlyCapRub=null (без лимита) → over=false', async () => {
    const ctx = build({ cap: { monthlyCapRub: null, capKind: 'hard' } });
    const res = await ctx.guard.evaluate('t1');
    expect(res.over).toBe(false);
    expect(res.capRub).toBeNull();
    expect(ctx.queryRaw).not.toHaveBeenCalled();
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

  it('кэш MTD: 2 evaluate подряд в пределах TTL → queryRaw вызван 1 раз', async () => {
    const ctx = build({ cap: { monthlyCapRub: 100, capKind: 'hard' }, mtdRub: 50, ttlSec: 60 });
    await ctx.guard.evaluate('t1');
    await ctx.guard.evaluate('t1');
    expect(ctx.queryRaw).toHaveBeenCalledTimes(1);
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

  it('смешанный месяц — построчный COALESCE учитывает NULL-строки через fxRate', async () => {
    const findUnique = vi.fn(async () => ({ monthlyCapRub: 100, capKind: 'hard' }));
    const queryRaw = vi.fn(async () => [{ total_rub: '140' }]);
    const prisma = {
      orgBudgetCap: { findUnique },
      $queryRaw: queryRaw,
    } as unknown as PrismaService;
    const getDynamic = vi.fn(async (_key: string, _env: unknown, def: unknown) => def);
    const cfg = { getDynamic } as unknown as TypedConfigService;
    const currencyRate = {
      getCurrentUsdRubRate: vi.fn(async () => 90),
    } as unknown as CurrencyRateService;

    const guard = new BudgetGuardService(prisma, cfg, currencyRate);
    const res = await guard.evaluate('t1');

    expect(currencyRate.getCurrentUsdRubRate).toHaveBeenCalledTimes(1);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(res.mtdRub).toBe(140);
    expect(res.over).toBe(true);
  });

  it('downgrade-cap при mtd≥cap → over=true', async () => {
    const ctx = build({ cap: { monthlyCapRub: 100, capKind: 'downgrade' }, mtdRub: 100 });
    const res = await ctx.guard.evaluate('t1');
    expect(res.over).toBe(true);
    expect(res.mtdRub).toBe(100);
    expect(res.capRub).toBe(100);
    expect(res.capKind).toBe('downgrade');
  });

  it('downgrade-cap при mtd<cap → over=false', async () => {
    const ctx = build({ cap: { monthlyCapRub: 100, capKind: 'downgrade' }, mtdRub: 99.99 });
    const res = await ctx.guard.evaluate('t1');
    expect(res.over).toBe(false);
    expect(res.capKind).toBe('downgrade');
  });

  it('нет cap-записи, платформенный дефолт=5000, mtd<5000 → capRub=5000, capKind=soft, over=false', async () => {
    const ctx = build({ cap: null, defaultCapRub: 5000, mtdRub: 1000 });
    const res = await ctx.guard.evaluate('t1');
    expect(res.capRub).toBe(5000);
    expect(res.capKind).toBe('soft');
    expect(res.over).toBe(false);
    expect(res.mtdRub).toBe(1000);
  });

  it('нет cap-записи, платформенный дефолт=5000, mtd≥5000 → over=false (Р6: дефолт не включает блокировку сам по себе)', async () => {
    const ctx = build({ cap: null, defaultCapRub: 5000, mtdRub: 6000 });
    const res = await ctx.guard.evaluate('t1');
    expect(res.capRub).toBe(5000);
    expect(res.capKind).toBe('soft');
    expect(res.over).toBe(false);
  });

  it('нет cap-записи, платформенный дефолт не настроен (0, код-фолбэк) → capRub=null, over=false', async () => {
    const ctx = build({ cap: null, defaultCapRub: 0, mtdRub: 100 });
    const res = await ctx.guard.evaluate('t1');
    expect(res.capRub).toBeNull();
    expect(res.over).toBe(false);
    expect(ctx.queryRaw).not.toHaveBeenCalled();
  });
});
