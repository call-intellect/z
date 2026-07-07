import { UnprocessableEntityException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { ALL_LLM_TASK_TYPES, type LlmRouterService } from '../../ai/services/llm-router.service';

import { AdminAiModelsService } from './ai-models.service';

describe('AdminAiModelsService — bulkReassign (ТЗ 2026-07-06 routing bulk-tool)', () => {
  const llmTaskRouteFindMany = vi.fn();
  const llmTaskRouteUpdateMany = vi.fn();
  const llmTaskRouteCreate = vi.fn();
  const llmTaskRouteChangeCreate = vi.fn();
  const llmProviderFindMany = vi.fn();
  const transaction = vi.fn();
  const refreshCache = vi.fn();
  const incAdminAiModelsRouteChange = vi.fn();

  const prisma = {
    llmTaskRoute: {
      findMany: llmTaskRouteFindMany,
      updateMany: llmTaskRouteUpdateMany,
      create: llmTaskRouteCreate,
    },
    llmTaskRouteChange: { create: llmTaskRouteChangeCreate },
    llmProvider: { findMany: llmProviderFindMany },
    $transaction: transaction,
  } as unknown as PrismaService;
  const router = { refreshCache } as unknown as LlmRouterService;
  const metrics = { incAdminAiModelsRouteChange } as unknown as BusinessMetricsService;

  let svc: AdminAiModelsService;

  beforeEach(() => {
    vi.clearAllMocks();
    llmProviderFindMany.mockResolvedValue([]);
    refreshCache.mockResolvedValue(undefined);
    transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: typeof prisma) => Promise<unknown>)(prisma);
      }
      return Promise.all(arg as Promise<unknown>[]);
    });
    svc = new AdminAiModelsService(prisma, router, metrics);
  });

  describe('previewBulkReassign', () => {
    it("scope='provider' → возвращает все (taskType,tier), где providerName===fromProviderName", async () => {
      llmTaskRouteFindMany.mockResolvedValueOnce([
        { taskType: 'summary', tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-pro' },
        { taskType: 'chat', tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
      ]);

      const res = await svc.previewBulkReassign({ scope: 'provider', fromProviderName: 'deepseek' });

      expect(res.affected).toHaveLength(2);
      expect(res.affected).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ taskType: 'summary', tier: 'primary', currentProviderName: 'deepseek' }),
          expect.objectContaining({ taskType: 'chat', tier: 'primary', currentProviderName: 'deepseek' }),
        ]),
      );
      expect(llmTaskRouteFindMany).toHaveBeenCalledWith({
        where: {
          tenantId: null,
          tier: { in: ['primary', 'secondary', 'tertiary'] },
          providerName: 'deepseek',
        },
        select: { taskType: true, tier: true, providerName: true, model: true },
      });
    });

    it("scope='provider' + tier — сужает до одного тира", async () => {
      llmTaskRouteFindMany.mockResolvedValueOnce([]);

      await svc.previewBulkReassign({ scope: 'provider', tier: 'secondary', fromProviderName: 'minimax' });

      expect(llmTaskRouteFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tier: { in: ['secondary'] } }) }),
      );
    });

    it("scope='unassigned' → находит (taskType,tier)-пары, для которых в БД вообще нет строки", async () => {
      llmTaskRouteFindMany.mockResolvedValueOnce([
        { taskType: ALL_LLM_TASK_TYPES[0], tier: 'primary' },
      ]);

      const res = await svc.previewBulkReassign({ scope: 'unassigned', tier: 'primary' });

      expect(res.affected.length).toBe(ALL_LLM_TASK_TYPES.length - 1);
      expect(res.affected.every((a) => a.tier === 'primary')).toBe(true);
      expect(res.affected.some((a) => a.taskType === ALL_LLM_TASK_TYPES[0])).toBe(false);
      expect(res.affected[0]?.currentProviderName).toBeNull();
    });
  });

  describe('bulkReassign', () => {
    it('toProviderName не найден ни в БД, ни в legacy-списке → UnprocessableEntityException, ничего не пишет', async () => {
      let err: unknown;
      try {
        await svc.bulkReassign(
          { scope: 'unassigned', toProviderName: 'ghost-provider', toModel: 'x', reason: 'test' },
          'user1',
        );
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect(transaction).not.toHaveBeenCalled();
    });

    it("scope='unassigned' → создаёт новую строку на КАЖДЫЙ незанятый (taskType,tier) и пишет audit с before:null", async () => {
      llmTaskRouteFindMany.mockResolvedValueOnce([
        { taskType: ALL_LLM_TASK_TYPES[0], tier: 'primary' },
      ]);

      const res = await svc.bulkReassign(
        { scope: 'unassigned', tier: 'primary', toProviderName: 'deepseek', toModel: 'deepseek-v4-pro', reason: 'sweep' },
        'user1',
      );

      expect(res.updated).toBe(ALL_LLM_TASK_TYPES.length - 1);
      expect(llmTaskRouteCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: null,
          tier: 'primary',
          providerName: 'deepseek',
          model: 'deepseek-v4-pro',
          isActive: true,
          editedByAdmin: true,
        }),
      });
      expect(llmTaskRouteChangeCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            changeType: 'bulk_reassign',
            before: { providerName: null, model: null },
            after: { providerName: 'deepseek', model: 'deepseek-v4-pro' },
            changedById: 'user1',
            reason: 'sweep',
          }),
        }),
      );
      expect(refreshCache).toHaveBeenCalled();
    });

    it("scope='provider' → UPDATE каждой найденной строки, audit с реальным before", async () => {
      llmTaskRouteFindMany.mockResolvedValueOnce([
        { taskType: 'summary', tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-pro' },
      ]);

      const res = await svc.bulkReassign(
        {
          scope: 'provider',
          fromProviderName: 'deepseek',
          toProviderName: 'openai-via-proxy',
          toModel: 'gpt-5-mini',
          reason: 'миграция вручную',
        },
        'user1',
      );

      expect(res.updated).toBe(1);
      expect(llmTaskRouteUpdateMany).toHaveBeenCalledWith({
        where: { tenantId: null, taskType: 'summary', tier: 'primary', providerName: 'deepseek' },
        data: { providerName: 'openai-via-proxy', model: 'gpt-5-mini', editedByAdmin: true },
      });
      expect(llmTaskRouteChangeCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            before: { providerName: 'deepseek', model: 'deepseek-v4-pro' },
            after: { providerName: 'openai-via-proxy', model: 'gpt-5-mini' },
          }),
        }),
      );
    });

    it('affected пуст (нечего менять) → не открывает транзакцию, updated:0', async () => {
      llmTaskRouteFindMany.mockResolvedValueOnce([]);

      const res = await svc.bulkReassign(
        { scope: 'provider', fromProviderName: 'ollama', toProviderName: 'deepseek', toModel: 'x', reason: 'r' },
        'user1',
      );

      expect(res).toEqual({ ok: true, updated: 0 });
      expect(transaction).not.toHaveBeenCalled();
    });
  });
});
