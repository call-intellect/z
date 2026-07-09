import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { CurrencyRateService } from '../economics/currency-rate.service';

import { AdminAiModelsService } from './ai-models.service';
import type { CreateExperimentDto } from './dto/ai-models.dto';

interface MetricsRawRowFixture {
  tier: 'primary' | 'secondary' | 'tertiary' | null;
  success: boolean;
  cnt: number;
  duration_sum: string | null;
  cost_usd_sum: string | null;
  cost_rub_sum: string | null;
}

interface BuildOpts {
  llmProviders?: Array<{ id: string; name: string }>;
  llmModels?: Array<{ id: string; providerId: string; modelKey: string }>;
  usdRubRate?: number | null;
  experiments?: Array<Record<string, unknown>>;
  metricsRawRows?: MetricsRawRowFixture[];
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

  let nextExperimentId = 1;
  const experimentsInDb: Array<Record<string, unknown>> = opts.experiments
    ? [...opts.experiments]
    : [];
  const experimentFindUnique = vi.fn(
    async (args: { where: { id: string } }) =>
      experimentsInDb.find((e) => e.id === args.where.id) ?? null,
  );
  const experimentCreate = vi.fn(async (args: { data: Record<string, unknown> }) => {
    const row = { id: `exp-${nextExperimentId++}`, ...args.data };
    experimentsInDb.push(row);
    return row;
  });
  const experimentUpdate = vi.fn(
    async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      const idx = experimentsInDb.findIndex((e) => e.id === args.where.id);
      if (idx >= 0) {
        experimentsInDb[idx] = { ...experimentsInDb[idx], ...args.data };
      }
      return experimentsInDb[idx];
    },
  );
  const experimentFindMany = vi.fn(async () => experimentsInDb);

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
      findUnique: experimentFindUnique,
      create: experimentCreate,
      update: experimentUpdate,
      findMany: experimentFindMany,
    },
    llmProvider: { findMany: llmProviderFindMany },
    llmModel: { findMany: llmModelFindMany },
    aiUsageLog: { groupBy: vi.fn(async () => []), findMany: vi.fn(async () => []) },
    $queryRaw: vi.fn(async () => opts.metricsRawRows ?? []),
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
  return {
    svc,
    prisma,
    routesInDb,
    auditCreate,
    metrics,
    router,
    deleteMany,
    createMany,
    experimentsInDb,
  };
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

  it('list() отдаёт effectivePrimary из llm.router.defaultChain только для taskType без явного primary', async () => {
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
    const cfg = {
      getDynamic: vi.fn(async () => [
        { provider: 'anthropic', model: 'claude-x' },
      ]),
    } as unknown as TypedConfigService;
    const svcWithCfg = new AdminAiModelsService(
      ctx.prisma,
      ctx.router,
      ctx.metrics,
      undefined,
      cfg,
    );

    const items = await svcWithCfg.list({});

    const summary = items.find((i) => i.taskType === 'summary');
    expect(summary?.primary).not.toBeNull();
    expect(summary?.effectivePrimary).toBeNull();

    const taskWithoutPrimary = items.find((i) => i.primary === null);
    expect(taskWithoutPrimary).toBeDefined();
    expect(taskWithoutPrimary?.effectivePrimary).toEqual({
      providerName: 'anthropic',
      model: 'claude-x',
    });
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

    it('costRub=null в БД (старая запись) → perTier.costRub считается фолбэком costUsd*usdRubRate', async () => {
      const ctx = build([], {
        usdRubRate: 90.5,
        metricsRawRows: [
          {
            tier: 'primary',
            success: true,
            cnt: 1,
            duration_sum: '100',
            cost_usd_sum: '1',
            cost_rub_sum: '90.5',
          },
        ],
      });
      const res = await ctx.svc.metrics_('summary', { period: '7d' });
      expect(res.perTier.primary.costRub).toBe(90.5);
    });

    it('costRub сохранён и НЕ совпадает с costUsd*usdRubRate → используется сохранённое значение (ключевой тест, доказывает что баг исправлен)', async () => {
      const ctx = build([], {
        usdRubRate: 90.5,
        metricsRawRows: [
          {
            tier: 'primary',
            success: true,
            cnt: 1,
            duration_sum: '100',
            cost_usd_sum: '1',
            cost_rub_sum: '100',
          },
        ],
      });
      const res = await ctx.svc.metrics_('summary', { period: '7d' });
      expect(res.perTier.primary.costRub).toBe(100);
    });

    it('usdRubRate=null → totals.totalCostRub и все perTier[t].costRub равны null', async () => {
      const ctx = build([], {
        usdRubRate: null,
        metricsRawRows: [
          {
            tier: 'primary',
            success: true,
            cnt: 1,
            duration_sum: '100',
            cost_usd_sum: '1',
            cost_rub_sum: '100',
          },
        ],
      });
      const res = await ctx.svc.metrics_('summary', { period: '7d' });
      expect(res.totals.totalCostRub).toBeNull();
      expect(res.perTier.primary.costRub).toBeNull();
      expect(res.perTier.secondary.costRub).toBeNull();
      expect(res.perTier.tertiary.costRub).toBeNull();
    });
  });

  // ТЗ 2026-07-03 Фаза 1 (R5) — мутации LlmModelExperiment обязаны немедленно
  // инвалидировать кэш LlmRouterService, иначе новый/остановленный эксперимент
  // применится только после минутного крона.
  describe('LlmModelExperiment → инвалидация кэша роутера (ТЗ 2026-07-03, R5)', () => {
    it('startExperiment: draft → running + router.refreshCache() вызван', async () => {
      const ctx = build([], {
        experiments: [
          {
            id: 'exp-1',
            taskType: 'summary',
            status: 'draft',
            controlModel: 'deepseek-v4-pro',
            controlProvider: 'deepseek',
            variantModel: 'deepseek-v4-flash',
            variantProvider: 'deepseek',
            splitPercent: 20,
            startedAt: null,
            endsAt: null,
          },
        ],
      });

      await ctx.svc.startExperiment('exp-1', 'user-1');

      const updated = ctx.experimentsInDb.find((e) => e.id === 'exp-1');
      expect(updated?.status).toBe('running');
      expect(ctx.router.refreshCache).toHaveBeenCalledOnce();
    });

    it('stopExperiment: running → stopped + router.refreshCache() вызван', async () => {
      const ctx = build([], {
        experiments: [
          {
            id: 'exp-1',
            taskType: 'summary',
            status: 'running',
            controlModel: 'deepseek-v4-pro',
            controlProvider: 'deepseek',
            variantModel: 'deepseek-v4-flash',
            variantProvider: 'deepseek',
            splitPercent: 20,
            startedAt: new Date(),
            endsAt: new Date(Date.now() + 3_600_000),
          },
        ],
      });

      await ctx.svc.stopExperiment('exp-1', 'user-1');

      const updated = ctx.experimentsInDb.find((e) => e.id === 'exp-1');
      expect(updated?.status).toBe('stopped');
      expect(ctx.router.refreshCache).toHaveBeenCalledOnce();
    });

    it('createExperiment (autoStart=false) создаёт draft и НЕ вызывает router.refreshCache()', async () => {
      const ctx = build([]);

      await ctx.svc.createExperiment(
        {
          taskType: 'summary',
          controlModel: 'deepseek-v4-pro',
          controlProvider: 'deepseek',
          variantModel: 'deepseek-v4-flash',
          variantProvider: 'deepseek',
          splitPercent: 20,
          durationDays: 7,
        } as CreateExperimentDto,
        'user-1',
      );

      expect(ctx.experimentsInDb).toHaveLength(1);
      expect(ctx.experimentsInDb[0]).toMatchObject({ status: 'draft' });
      expect(ctx.router.refreshCache).not.toHaveBeenCalled();
    });

    it('switchPrimary(abSplitPercent<100) создаёт running LlmModelExperiment и вызывает router.refreshCache()', async () => {
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
          reason: 'A/B тест перед полным переключением',
          abSplitPercent: 20,
          abDurationDays: 7,
        },
        'user-1',
      );

      expect(ctx.experimentsInDb).toHaveLength(1);
      expect(ctx.experimentsInDb[0]).toMatchObject({ status: 'running', taskType: 'summary' });
      expect(ctx.router.refreshCache).toHaveBeenCalledOnce();
    });
  });
});
