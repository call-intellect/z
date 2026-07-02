import { describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { CurrencyRateService } from '../economics/currency-rate.service';

import { AdminAiModelsService } from './ai-models.service';

interface BuildOpts {
  llmProviders?: Array<{ id: string; name: string }>;
  llmModels?: Array<{ id: string; providerId: string; modelKey: string }>;
  usdRubRate?: number | null;
}

function build(routesInDb: Array<Record<string, unknown>> = [], opts: BuildOpts = {}) {
  let nextId = 1;
  const findMany = vi.fn(async () => routesInDb);
  const findFirst = vi.fn(async (args: { where: Record<string, unknown> }) => {
    return (
      routesInDb.find((r) => {
        const w = args.where;
        for (const key of Object.keys(w)) {
          const expected = (w as Record<string, unknown>)[key];
          if (typeof expected === 'object' && expected !== null && 'not' in expected) {
            const val = (r as Record<string, unknown>)[key];
            const notVal = (expected as { not: unknown }).not;
            if (val === notVal) return false;
            continue;
          }
          if ((r as Record<string, unknown>)[key] !== expected) return false;
        }
        return true;
      }) ?? null
    );
  });
  const findUnique = vi.fn(
    async (args: { where: { id: string } }) =>
      routesInDb.find((r) => r.id === args.where.id) ?? null,
  );
  const update = vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
    const idx = routesInDb.findIndex((r) => r.id === args.where.id);
    if (idx >= 0) {
      routesInDb[idx] = { ...routesInDb[idx], ...args.data };
    }
    return routesInDb[idx];
  });
  const create = vi.fn(async (args: { data: Record<string, unknown> }) => {
    const row = { id: `r-${nextId++}`, ...args.data };
    routesInDb.push(row);
    return row;
  });
  const deleteFn = vi.fn(async (args: { where: { id: string } }) => {
    const idx = routesInDb.findIndex((r) => r.id === args.where.id);
    if (idx >= 0) {
      routesInDb.splice(idx, 1);
    }
    return null;
  });
  const count = vi.fn(async (args: { where: Record<string, unknown> }) => {
    let n = 0;
    for (const r of routesInDb) {
      let ok = true;
      for (const key of Object.keys(args.where)) {
        if ((r as Record<string, unknown>)[key] !== args.where[key]) {
          ok = false;
          break;
        }
      }
      if (ok) n++;
    }
    return n;
  });
  const auditCreate = vi.fn(async () => ({}));
  const auditCount = vi.fn(async () => 0);

  const matchesWhere = (r: Record<string, unknown>, where: Record<string, unknown>): boolean => {
    for (const key of Object.keys(where)) {
      const expected = where[key];
      if (typeof expected === 'object' && expected !== null && 'not' in expected) {
        const val = r[key];
        const notVal = (expected as { not: unknown }).not;
        if (val === notVal) return false;
        continue;
      }
      if (r[key] !== expected) return false;
    }
    return true;
  };
  const deleteMany = vi.fn(async (args: { where: Record<string, unknown> }) => {
    let count_ = 0;
    for (let i = routesInDb.length - 1; i >= 0; i--) {
      if (matchesWhere(routesInDb[i] as Record<string, unknown>, args.where)) {
        routesInDb.splice(i, 1);
        count_++;
      }
    }
    return { count: count_ };
  });
  const createMany = vi.fn(async (args: { data: Array<Record<string, unknown>> }) => {
    for (const row of args.data) {
      routesInDb.push({ id: `r-${nextId++}`, ...row });
    }
    return { count: args.data.length };
  });

  const llmProviders = opts.llmProviders ?? [];
  const llmModels = opts.llmModels ?? [];
  const llmProviderFindMany = vi.fn(async () => llmProviders);
  const llmModelFindMany = vi.fn(async () => llmModels);

  const prisma = {
    llmTaskRoute: {
      findMany,
      findFirst,
      findUnique,
      update,
      create,
      delete: deleteFn,
      count,
      deleteMany,
      createMany,
    },
    llmTaskRouteChange: { create: auditCreate, count: auditCount, findMany: vi.fn(async () => []) },
    llmModelExperiment: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
      update: vi.fn(),
      findMany: vi.fn(async () => []),
    },
    llmProvider: { findMany: llmProviderFindMany },
    llmModel: { findMany: llmModelFindMany },
    aiUsageLog: { groupBy: vi.fn(async () => []), findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn({
        llmTaskRoute: { findFirst, update, create, deleteMany, createMany },
      });
    }),
  } as unknown as PrismaService;

  const router = { refreshCache: vi.fn(async () => undefined) } as unknown as LlmRouterService;
  const metrics = {
    incAdminAiModelsRouteChange: vi.fn(),
    incAdminAiModelsExperimentStarted: vi.fn(),
    incAdminAiModelsExperimentStopped: vi.fn(),
    incAdminAiModelsExperimentCompleted: vi.fn(),
    incCoreLlmNoProvider: vi.fn(),
  } as unknown as BusinessMetricsService;

  const getCurrentUsdRubRate = vi.fn(async () => {
    if (opts.usdRubRate === null) throw new Error('rate unavailable');
    return opts.usdRubRate ?? 90.5;
  });
  const currencyRate =
    opts.usdRubRate !== undefined
      ? ({ getCurrentUsdRubRate } as unknown as CurrencyRateService)
      : undefined;

  const svc = new AdminAiModelsService(prisma, router, metrics, currencyRate);
  return { svc, prisma, routesInDb, auditCreate, metrics, router, deleteMany, createMany };
}

describe('AdminAiModelsService', () => {
  it('list() группирует taskType-ы (ai-pipeline/knowledge-core/competitor-parity)', async () => {
    const { svc } = build([
      {
        id: 'r1',
        taskType: 'summary',
        tenantId: null,
        tier: 'primary',
        priority: 0,
        providerName: 'deepseek',
        model: 'deepseek-v4-pro',
        editedByAdmin: false,
      },
      {
        id: 'r2',
        taskType: 'block-ingest',
        tenantId: null,
        tier: 'primary',
        priority: 0,
        providerName: 'deepseek',
        model: 'deepseek-v4-flash',
        editedByAdmin: false,
      },
    ]);
    const items = await svc.list({});
    const summary = items.find((i) => i.taskType === 'summary');
    expect(summary?.group).toBe('ai-pipeline');
    const block = items.find((i) => i.taskType === 'block-ingest');
    expect(block?.group).toBe('knowledge-core');
  });

  it('switchPrimary(splitPercent=100) — мгновенно переключает primary + audit-запись', async () => {
    const ctx = build([
      {
        id: 'r1',
        taskType: 'summary',
        tenantId: null,
        tier: 'primary',
        priority: 0,
        providerName: 'deepseek',
        model: 'deepseek-v4-pro',
        editedByAdmin: false,
      },
    ]);
    await ctx.svc.switchPrimary(
      'summary',
      {
        providerName: 'openai-via-proxy',
        model: 'gpt-5.5',
        reason: 'A/B победил GPT-5.5',
      },
      'user-1',
    );
    const old = ctx.routesInDb.find((r) => r.providerName === 'deepseek');
    expect(old?.tier).toBe('secondary');
    const newPrimary = ctx.routesInDb.find(
      (r) => r.providerName === 'openai-via-proxy' && r.tier === 'primary',
    );
    expect(newPrimary).toBeDefined();
    expect(ctx.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          taskType: 'summary',
          changeType: 'switched_primary',
          reason: 'A/B победил GPT-5.5',
        }),
      }),
    );
  });

  it('addProvider не позволяет дублировать (tier, providerName)', async () => {
    const ctx = build([
      {
        id: 'r1',
        taskType: 'tasks',
        tenantId: null,
        tier: 'secondary',
        priority: 0,
        providerName: 'openai-via-proxy',
        model: 'gpt-5.4-mini',
        editedByAdmin: false,
      },
    ]);
    await expect(
      ctx.svc.addProvider(
        'tasks',
        { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4' },
        'user-1',
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        error: expect.objectContaining({ code: 'provider_already_in_tier' }),
      }),
    });
  });

  it('removeProvider блокирует удаление последнего primary', async () => {
    const ctx = build([
      {
        id: 'p1',
        taskType: 'summary',
        tenantId: null,
        tier: 'primary',
        priority: 0,
        providerName: 'deepseek',
        model: 'deepseek-v4-pro',
        editedByAdmin: false,
      },
    ]);
    await expect(ctx.svc.removeProvider('summary', 'p1', 'user-1')).rejects.toMatchObject({
      response: expect.objectContaining({
        error: expect.objectContaining({ code: 'cannot_remove_last_primary' }),
      }),
    });
  });

  describe('putChain (Ф6)', () => {
    it('успешная замена цепочки → deleteMany+createMany вызваны, refreshCache вызван, audit chain_replaced', async () => {
      const ctx = build(
        [
          {
            id: 'r1',
            taskType: 'summary',
            tenantId: null,
            tier: 'primary',
            priority: 0,
            providerName: 'deepseek',
            model: 'deepseek-v4-pro',
            editedByAdmin: false,
          },
        ],
        {
          llmProviders: [{ id: 'lp-1', name: 'deepseek' }],
          llmModels: [{ id: 'lm-1', providerId: 'lp-1', modelKey: 'deepseek-v4-flash' }],
        },
      );
      const res = await ctx.svc.putChain(
        'summary',
        {
          entries: [
            { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash', priority: 0 },
          ],
          isActive: true,
          reason: 'ручная правка',
        },
        'user-1',
      );
      expect(res.ok).toBe(true);
      expect(res.warnings).toEqual([]);
      expect(ctx.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: null, taskType: 'summary' }),
        }),
      );
      expect(ctx.createMany).toHaveBeenCalledOnce();
      expect(ctx.router.refreshCache).toHaveBeenCalledOnce();
      expect(ctx.auditCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ taskType: 'summary', changeType: 'chain_replaced' }),
        }),
      );
      const newRow = ctx.routesInDb.find((r) => r.model === 'deepseek-v4-flash');
      expect(newRow).toBeDefined();
    });

    it('неизвестный providerName → UnprocessableEntityException route_provider_unknown', async () => {
      const ctx = build([], { llmProviders: [] });
      await expect(
        ctx.svc.putChain(
          'summary',
          {
            entries: [{ tier: 'primary', providerName: 'totally-unknown', priority: 0 }],
            isActive: true,
            reason: 'тест',
          },
          'user-1',
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error: expect.objectContaining({ code: 'route_provider_unknown' }),
        }),
      });
      expect(ctx.createMany).not.toHaveBeenCalled();
    });

    it('providerName из активного DB-реестра (не legacy-7) → проходит валидацию', async () => {
      const ctx = build([], { llmProviders: [{ id: 'lp-9', name: 'my-custom-provider' }] });
      const res = await ctx.svc.putChain(
        'summary',
        {
          entries: [{ tier: 'primary', providerName: 'my-custom-provider', priority: 0 }],
          isActive: true,
          reason: 'новый провайдер из реестра',
        },
        'user-1',
      );
      expect(res.ok).toBe(true);
    });

    it('модель вне каталога провайдера → warnings непустой, операция не падает', async () => {
      const ctx = build([], {
        llmProviders: [{ id: 'lp-1', name: 'deepseek' }],
        llmModels: [{ id: 'lm-1', providerId: 'lp-1', modelKey: 'deepseek-v4-pro' }],
      });
      const res = await ctx.svc.putChain(
        'summary',
        {
          entries: [
            {
              tier: 'primary',
              providerName: 'deepseek',
              model: 'deepseek-vNext-does-not-exist',
              priority: 0,
            },
          ],
          isActive: true,
          reason: 'тест каталога',
        },
        'user-1',
      );
      expect(res.ok).toBe(true);
      expect(res.warnings).toEqual([
        'model_not_in_catalog: deepseek/deepseek-vNext-does-not-exist',
      ]);
      expect(ctx.createMany).toHaveBeenCalledOnce();
    });
  });

  describe('metrics_ usdRubRate (Ф6)', () => {
    it('CurrencyRateService вернул курс → ответ содержит usdRubRate', async () => {
      const ctx = build([], { usdRubRate: 90.5 });
      const res = await ctx.svc.metrics_('summary', { period: '7d' });
      expect(res.usdRubRate).toBe(90.5);
    });

    it('без инжекции CurrencyRateService → usdRubRate=null, не падает', async () => {
      const ctx = build([]);
      const res = await ctx.svc.metrics_('summary', { period: '7d' });
      expect(res.usdRubRate).toBeNull();
    });

    it('CurrencyRateService бросил → usdRubRate=null, не падает', async () => {
      const ctx = build([], { usdRubRate: null });
      const res = await ctx.svc.metrics_('summary', { period: '7d' });
      expect(res.usdRubRate).toBeNull();
    });
  });
});
