import { describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';

import { AdminAiModelsService } from './ai-models.service';

function build(routesInDb: Array<Record<string, unknown>> = []) {
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

  const prisma = {
    llmTaskRoute: {
      findMany,
      findFirst,
      findUnique,
      update,
      create,
      delete: deleteFn,
      count,
    },
    llmTaskRouteChange: { create: auditCreate, count: auditCount, findMany: vi.fn(async () => []) },
    llmModelExperiment: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
      update: vi.fn(),
      findMany: vi.fn(async () => []),
    },
    aiUsageLog: { groupBy: vi.fn(async () => []), findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn({
        llmTaskRoute: { findFirst, update, create },
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

  const svc = new AdminAiModelsService(prisma, router, metrics);
  return { svc, prisma, routesInDb, auditCreate, metrics, router };
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
});
