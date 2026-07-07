import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminLlmModelsService } from './admin-llm-models.service';

const FIXED_DATE = new Date('2026-01-01T00:00:00.000Z');

function fakeProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    name: 'deepseek',
    displayName: 'DeepSeek',
    defaultModelKey: null as string | null,
    ...overrides,
  };
}

function fakeModel(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    providerId: 'p1',
    modelKey: 'deepseek-v4-flash',
    displayName: 'DeepSeek v4 Flash',
    contextWindow: null,
    capabilitiesJson: null,
    category: null,
    isActive: true,
    verifiedAt: null,
    notes: null,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    deletedAt: null,
    provider: fakeProvider(),
    ...overrides,
  };
}

describe('AdminLlmModelsService', () => {
  const llmModelFindMany = vi.fn();
  const llmModelFindUnique = vi.fn();
  const llmModelFindFirst = vi.fn();
  const llmModelUpdate = vi.fn();
  const llmModelCreate = vi.fn();
  const llmProviderUpdate = vi.fn();
  const llmProviderFindUniqueOrThrow = vi.fn();
  const llmTaskRouteFindFirst = vi.fn();
  const llmTaskRouteFindMany = vi.fn();
  const llmTaskRouteUpdate = vi.fn();
  const llmTaskRouteChangeCreate = vi.fn();
  const transaction = vi.fn();
  const invalidate = vi.fn();
  const getDynamic = vi.fn();
  const refreshCache = vi.fn();

  const prisma = {
    llmModel: {
      findMany: llmModelFindMany,
      findUnique: llmModelFindUnique,
      findFirst: llmModelFindFirst,
      update: llmModelUpdate,
      create: llmModelCreate,
    },
    llmProvider: {
      update: llmProviderUpdate,
      findUniqueOrThrow: llmProviderFindUniqueOrThrow,
    },
    llmTaskRoute: {
      findFirst: llmTaskRouteFindFirst,
      findMany: llmTaskRouteFindMany,
      update: llmTaskRouteUpdate,
    },
    llmTaskRouteChange: { create: llmTaskRouteChangeCreate },
    llmModelPrice: { findMany: vi.fn() },
    $transaction: transaction,
  } as unknown as ConstructorParameters<typeof AdminLlmModelsService>[0];
  const cfg = { getDynamic } as unknown as ConstructorParameters<typeof AdminLlmModelsService>[1];
  const providerInfo = { invalidate } as unknown as ConstructorParameters<
    typeof AdminLlmModelsService
  >[2];
  const router = { refreshCache } as unknown as ConstructorParameters<
    typeof AdminLlmModelsService
  >[3];

  let svc: AdminLlmModelsService;

  beforeEach(() => {
    vi.clearAllMocks();
    llmModelFindFirst.mockResolvedValue(null);
    llmTaskRouteFindFirst.mockResolvedValue(null);
    llmTaskRouteFindMany.mockResolvedValue([]);
    llmTaskRouteUpdate.mockResolvedValue({});
    llmTaskRouteChangeCreate.mockResolvedValue({});
    refreshCache.mockResolvedValue(undefined);
    getDynamic.mockResolvedValue([]);
    transaction.mockImplementation((arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: typeof prisma) => Promise<unknown>)(prisma);
      }
      return Promise.all(arg as Promise<unknown>[]);
    });
    svc = new AdminLlmModelsService(prisma, cfg, providerInfo, router);
  });

  it('getById бросает NotFoundException model_not_found для отсутствующей/soft-deleted строки', async () => {
    llmModelFindUnique.mockResolvedValueOnce(null);

    let err: unknown;
    try {
      await svc.getById('missing');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(NotFoundException);
    expect((err as NotFoundException).getResponse()).toMatchObject({
      error: { code: 'model_not_found' },
    });
  });

  it('list() возвращает isDefault:true только для модели, чей modelKey совпадает с provider.defaultModelKey', async () => {
    llmModelFindMany.mockResolvedValueOnce([
      fakeModel({
        id: 'm1',
        modelKey: 'deepseek-v4-flash',
        provider: fakeProvider({ defaultModelKey: 'deepseek-v4-flash' }),
      }),
      fakeModel({
        id: 'm2',
        modelKey: 'deepseek-v4-lite',
        provider: fakeProvider({ defaultModelKey: 'deepseek-v4-flash' }),
      }),
    ]);

    const res = await svc.list({ includeInactive: false });

    expect(res.items.find((m) => m.id === 'm1')?.isDefault).toBe(true);
    expect(res.items.find((m) => m.id === 'm2')?.isDefault).toBe(false);
  });

  describe('setDefaultModel', () => {
    it('модель активна → провайдеру проставлен defaultModelKey = modelKey', async () => {
      llmModelFindUnique.mockResolvedValueOnce(fakeModel({ isActive: true }));
      llmProviderUpdate.mockResolvedValueOnce({});

      const res = await svc.setDefaultModel('m1');

      expect(res).toEqual({ ok: true });
      expect(llmProviderUpdate).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { defaultModelKey: 'deepseek-v4-flash' },
      });
      expect(invalidate).toHaveBeenCalled();
    });

    it('модель неактивна → UnprocessableEntityException default_model_inactive, провайдер не тронут', async () => {
      llmModelFindUnique.mockResolvedValueOnce(fakeModel({ isActive: false }));

      let err: unknown;
      try {
        await svc.setDefaultModel('m1');
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect((err as UnprocessableEntityException).getResponse()).toMatchObject({
        error: { code: 'default_model_inactive' },
      });
      expect(llmProviderUpdate).not.toHaveBeenCalled();
    });
  });

  describe('previewRemoval', () => {
    it('занята в тир-маршруте + legacy JSON-маршруте, дефолт назначен на другую модель → считает оба, currentDefaultModel возвращён', async () => {
      llmModelFindUnique.mockResolvedValueOnce(
        fakeModel({
          modelKey: 'deepseek-v4-flash',
          provider: fakeProvider({ defaultModelKey: 'deepseek-v4-lite' }),
        }),
      );
      llmTaskRouteFindMany
        .mockResolvedValueOnce([{ tenantId: null }, { tenantId: 'org1' }])
        .mockResolvedValueOnce([
          {
            tenantId: 'org2',
            providers: [{ provider: 'deepseek', model: 'deepseek-v4-flash' }],
          },
          { tenantId: 'org3', providers: [{ provider: 'deepseek', model: 'deepseek-v4-lite' }] },
        ]);
      getDynamic.mockResolvedValueOnce([{ provider: 'deepseek', model: 'deepseek-v4-flash' }]);

      const res = await svc.previewRemoval('m1');

      expect(res).toEqual({
        modelKey: 'deepseek-v4-flash',
        providerName: 'deepseek',
        isDefault: false,
        affectedRoutesCount: 3,
        affectedTenantsCount: 3,
        inDefaultChain: true,
        currentDefaultModel: 'deepseek-v4-lite',
      });
    });

    it('модель нигде не используется, дефолт не назначен → нулевые счётчики, currentDefaultModel:null', async () => {
      llmModelFindUnique.mockResolvedValueOnce(fakeModel({ provider: fakeProvider() }));
      llmTaskRouteFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const res = await svc.previewRemoval('m1');

      expect(res).toEqual({
        modelKey: 'deepseek-v4-flash',
        providerName: 'deepseek',
        isDefault: false,
        affectedRoutesCount: 0,
        affectedTenantsCount: 0,
        inDefaultChain: false,
        currentDefaultModel: null,
      });
    });
  });

  describe('softDeleteWithFallback', () => {
    it('(a) не дефолт, нигде не используется → soft-удаляет без миграции', async () => {
      llmModelFindUnique.mockResolvedValueOnce(fakeModel({ provider: fakeProvider() }));
      llmProviderFindUniqueOrThrow.mockResolvedValueOnce(fakeProvider());
      llmTaskRouteFindFirst.mockResolvedValueOnce(null);
      llmModelUpdate.mockResolvedValueOnce({});

      const res = await svc.softDeleteWithFallback('m1', {}, 'user1');

      expect(res).toEqual({ ok: true, routesMigrated: 0 });
      expect(llmModelUpdate).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { deletedAt: expect.any(Date), isActive: false },
      });
    });

    it('(b) не дефолт, используется, дефолт провайдера НЕ назначен → ConflictException model_in_use_by_routes (жёсткий отказ, как у провайдера)', async () => {
      llmModelFindUnique.mockResolvedValueOnce(fakeModel({ provider: fakeProvider() }));
      llmProviderFindUniqueOrThrow.mockResolvedValueOnce(fakeProvider());
      llmTaskRouteFindFirst.mockResolvedValueOnce({ taskType: 'tasks' });

      let err: unknown;
      try {
        await svc.softDeleteWithFallback('m1', {}, 'user1');
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toMatchObject({
        error: { code: 'model_in_use_by_routes' },
      });
      expect(llmModelUpdate).not.toHaveBeenCalled();
    });

    it('(c) не дефолт, используется в тир-маршруте, дефолт провайдера назначен на другую модель → маршрут переключён, audit-запись создана', async () => {
      llmModelFindUnique.mockResolvedValueOnce(
        fakeModel({
          modelKey: 'deepseek-v4-flash',
          provider: fakeProvider({ defaultModelKey: 'deepseek-v4-lite' }),
        }),
      );
      llmProviderFindUniqueOrThrow.mockResolvedValueOnce(
        fakeProvider({ defaultModelKey: 'deepseek-v4-lite' }),
      );
      llmTaskRouteFindMany
        .mockResolvedValueOnce([
          {
            id: 'r1',
            taskType: 'tasks',
            tenantId: null,
            tier: 'primary',
            providerName: 'deepseek',
            model: 'deepseek-v4-flash',
          },
        ])
        .mockResolvedValueOnce([]);
      llmModelUpdate.mockResolvedValueOnce({});

      const res = await svc.softDeleteWithFallback('m1', {}, 'user1');

      expect(res).toEqual({ ok: true, routesMigrated: 1 });
      expect(llmTaskRouteUpdate).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { model: 'deepseek-v4-lite' },
      });
      expect(llmTaskRouteChangeCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          taskType: 'tasks',
          tenantId: null,
          tier: 'primary',
          changeType: 'model_deleted_auto_migrated',
          before: { providerName: 'deepseek', model: 'deepseek-v4-flash' },
          after: { providerName: 'deepseek', model: 'deepseek-v4-lite' },
          changedById: 'user1',
          reason: 'model_deleted_auto_migrated',
        }),
      });
      expect(invalidate).toHaveBeenCalled();
      expect(refreshCache).toHaveBeenCalled();
    });

    it('(d) legacy JSON-маршрут с дублем после замены → дедуп по provider+model, вторая запись убрана', async () => {
      llmModelFindUnique.mockResolvedValueOnce(
        fakeModel({
          modelKey: 'deepseek-v4-flash',
          provider: fakeProvider({ defaultModelKey: 'deepseek-v4-lite' }),
        }),
      );
      llmProviderFindUniqueOrThrow.mockResolvedValueOnce(
        fakeProvider({ defaultModelKey: 'deepseek-v4-lite' }),
      );
      llmTaskRouteFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          id: 'legacy1',
          taskType: 'chat',
          tenantId: null,
          tier: null,
          providers: [
            { provider: 'deepseek', model: 'deepseek-v4-flash' },
            { provider: 'deepseek', model: 'deepseek-v4-lite' },
          ],
        },
      ]);
      llmModelUpdate.mockResolvedValueOnce({});

      const res = await svc.softDeleteWithFallback('m1', {}, 'user1');

      expect(res).toEqual({ ok: true, routesMigrated: 1 });
      expect(llmTaskRouteUpdate).toHaveBeenCalledWith({
        where: { id: 'legacy1' },
        data: { providers: [{ provider: 'deepseek', model: 'deepseek-v4-lite' }] },
      });
    });

    it('(e) удаление дефолтной модели БЕЗ reassignDefaultModelTo → ConflictException must_reassign_default_model', async () => {
      llmModelFindUnique.mockResolvedValueOnce(
        fakeModel({
          modelKey: 'deepseek-v4-flash',
          provider: fakeProvider({ defaultModelKey: 'deepseek-v4-flash' }),
        }),
      );

      let err: unknown;
      try {
        await svc.softDeleteWithFallback('m1', {}, 'user1');
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toMatchObject({
        error: { code: 'must_reassign_default_model' },
      });
      expect(llmProviderUpdate).not.toHaveBeenCalled();
      expect(llmModelUpdate).not.toHaveBeenCalled();
    });

    it('(f) удаление дефолтной модели с reassignDefaultModelTo на невалидную/неактивную модель → UnprocessableEntityException default_model_invalid', async () => {
      llmModelFindUnique.mockResolvedValueOnce(
        fakeModel({
          modelKey: 'deepseek-v4-flash',
          provider: fakeProvider({ defaultModelKey: 'deepseek-v4-flash' }),
        }),
      );
      llmModelFindFirst.mockResolvedValueOnce(null);

      let err: unknown;
      try {
        await svc.softDeleteWithFallback('m1', { reassignDefaultModelTo: 'ghost-model' }, 'user1');
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect((err as UnprocessableEntityException).getResponse()).toMatchObject({
        error: { code: 'default_model_invalid' },
      });
      expect(llmProviderUpdate).not.toHaveBeenCalled();
    });

    it('(g) удаление дефолтной модели с валидным reassignDefaultModelTo → provider.defaultModelKey переключён, старые маршруты по старой модели мигрируют на новую, старая soft-удалена', async () => {
      llmModelFindUnique.mockResolvedValueOnce(
        fakeModel({
          modelKey: 'deepseek-v4-flash',
          provider: fakeProvider({ defaultModelKey: 'deepseek-v4-flash' }),
        }),
      );
      llmModelFindFirst.mockResolvedValueOnce({
        id: 'm2',
        providerId: 'p1',
        modelKey: 'deepseek-v4-lite',
        isActive: true,
        deletedAt: null,
      });
      llmProviderUpdate.mockResolvedValueOnce({});
      llmProviderFindUniqueOrThrow.mockResolvedValueOnce(
        fakeProvider({ defaultModelKey: 'deepseek-v4-lite' }),
      );
      llmTaskRouteFindMany
        .mockResolvedValueOnce([
          {
            id: 'r1',
            taskType: 'tasks',
            tenantId: null,
            tier: 'primary',
            providerName: 'deepseek',
            model: 'deepseek-v4-flash',
          },
        ])
        .mockResolvedValueOnce([]);
      llmModelUpdate.mockResolvedValueOnce({});

      const res = await svc.softDeleteWithFallback(
        'm1',
        { reassignDefaultModelTo: 'deepseek-v4-lite' },
        'user1',
      );

      expect(res).toEqual({ ok: true, routesMigrated: 1 });
      expect(llmProviderUpdate).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { defaultModelKey: 'deepseek-v4-lite' },
      });
      expect(llmTaskRouteUpdate).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { model: 'deepseek-v4-lite' },
      });
      expect(llmModelUpdate).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { deletedAt: expect.any(Date), isActive: false },
      });
    });
  });
});
