import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminLlmProvidersService } from './admin-llm-providers.service';
import { discoverProviderModels } from './discover-provider-models.util';

vi.mock('./discover-provider-models.util', () => ({
  discoverProviderModels: vi.fn(),
}));

const FIXED_DATE = new Date('2026-01-01T00:00:00.000Z');

function fakeProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    name: 'deepseek',
    displayName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    protocolKind: 'openai-chat',
    capability: 'public',
    apiKeyEncrypted: null,
    defaultHeaders: null,
    globalRps: null,
    isActive: true,
    isDefaultProvider: false,
    useProxy: false,
    proxyPath: null,
    timeoutMs: null,
    defaultModelKey: null,
    billingMode: 'per_token',
    subscriptionMonthlyCostUsd: null,
    subscriptionStartedAt: null,
    lastSmokeAt: null,
    lastSmokeSuccess: null,
    lastSmokeError: null,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    deletedAt: null,
    ...overrides,
  };
}

describe('AdminLlmProvidersService', () => {
  const findMany = vi.fn();
  const findUnique = vi.fn();
  const create = vi.fn();
  const update = vi.fn();
  const updateMany = vi.fn();
  const llmProviderFindFirst = vi.fn();
  const llmModelFindMany = vi.fn();
  const llmModelFindFirst = vi.fn();
  const llmTaskRouteFindFirst = vi.fn();
  const llmTaskRouteFindMany = vi.fn();
  const llmTaskRouteUpdate = vi.fn();
  const llmTaskRouteDelete = vi.fn();
  const llmTaskRouteChangeCreate = vi.fn();
  const adminSettingUpsert = vi.fn();
  const transaction = vi.fn();
  const encrypt = vi.fn(() => 'gcm:v1:mocked');
  const isEncrypted = vi.fn((v: string) => v.startsWith('gcm:v1:'));
  const invalidate = vi.fn();
  const resolveByName = vi.fn();
  const getDynamic = vi.fn();
  const refreshCache = vi.fn();
  const adminSettingsSet = vi.fn();

  const prisma = {
    llmProvider: {
      findMany,
      findUnique,
      create,
      update,
      updateMany,
      findFirst: llmProviderFindFirst,
    },
    llmModel: { findMany: llmModelFindMany, findFirst: llmModelFindFirst },
    llmTaskRoute: {
      findFirst: llmTaskRouteFindFirst,
      findMany: llmTaskRouteFindMany,
      update: llmTaskRouteUpdate,
      delete: llmTaskRouteDelete,
    },
    llmTaskRouteChange: { create: llmTaskRouteChangeCreate },
    adminSetting: { upsert: adminSettingUpsert },
    $transaction: transaction,
  } as unknown as ConstructorParameters<typeof AdminLlmProvidersService>[0];
  const crypto = { encrypt, isEncrypted } as unknown as ConstructorParameters<
    typeof AdminLlmProvidersService
  >[1];
  const providerInfo = { invalidate, resolveByName } as unknown as ConstructorParameters<
    typeof AdminLlmProvidersService
  >[2];
  const cfg = { getDynamic } as unknown as ConstructorParameters<
    typeof AdminLlmProvidersService
  >[3];
  const router = { refreshCache } as unknown as ConstructorParameters<
    typeof AdminLlmProvidersService
  >[4];
  const adminSettings = { set: adminSettingsSet } as unknown as ConstructorParameters<
    typeof AdminLlmProvidersService
  >[5];

  let svc: AdminLlmProvidersService;

  beforeEach(() => {
    vi.clearAllMocks();
    encrypt.mockReturnValue('gcm:v1:mocked');
    llmModelFindMany.mockResolvedValue([]);
    llmModelFindFirst.mockResolvedValue(null);
    llmProviderFindFirst.mockResolvedValue(null);
    llmTaskRouteFindFirst.mockResolvedValue(null);
    llmTaskRouteFindMany.mockResolvedValue([]);
    llmTaskRouteUpdate.mockResolvedValue({});
    llmTaskRouteDelete.mockResolvedValue({});
    llmTaskRouteChangeCreate.mockResolvedValue({});
    adminSettingUpsert.mockResolvedValue({});
    refreshCache.mockResolvedValue(undefined);
    adminSettingsSet.mockResolvedValue(undefined);
    transaction.mockImplementation((arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: typeof prisma) => Promise<unknown>)(prisma);
      }
      return Promise.all(arg as Promise<unknown>[]);
    });
    getDynamic.mockResolvedValue([]);
    svc = new AdminLlmProvidersService(prisma, crypto, providerInfo);
  });

  const createDto = {
    name: 'deepseek',
    displayName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    protocolKind: 'openai-chat' as const,
    capability: 'public' as const,
    apiKey: 'secret-key',
    isActive: true,
    useProxy: false,
    billingMode: 'per_token' as const,
  };

  it('(a) create с apiKey шифрует ключ через crypto.encrypt (gcm:v1:-префикс в data)', async () => {
    findUnique.mockResolvedValueOnce(null);
    create.mockResolvedValueOnce(fakeProvider({ apiKeyEncrypted: 'gcm:v1:mocked' }));

    await svc.create(createDto);

    expect(encrypt).toHaveBeenCalledWith('secret-key');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ apiKeyEncrypted: 'gcm:v1:mocked' }),
      }),
    );
  });

  it('create с дублем name бросает ConflictException provider_exists', async () => {
    findUnique.mockResolvedValueOnce(fakeProvider());

    let err: unknown;
    try {
      await svc.create(createDto);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      error: { code: 'provider_exists' },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('(b) list/getById/create/update не содержат apiKeyEncrypted в ответе, содержат hasApiKey', async () => {
    findMany.mockResolvedValueOnce([fakeProvider({ apiKeyEncrypted: 'gcm:v1:mocked' })]);
    const listRes = await svc.list({ includeInactive: false });
    expect(listRes.items[0]).not.toHaveProperty('apiKeyEncrypted');
    expect(listRes.items[0]?.hasApiKey).toBe(true);
    expect(JSON.stringify(listRes)).not.toContain('gcm:v1:mocked');

    findUnique.mockResolvedValueOnce(fakeProvider({ apiKeyEncrypted: 'gcm:v1:mocked' }));
    const getRes = await svc.getById('p1');
    expect(getRes).not.toHaveProperty('apiKeyEncrypted');
    expect(getRes.hasApiKey).toBe(true);
    expect(JSON.stringify(getRes)).not.toContain('gcm:v1:mocked');

    findUnique.mockResolvedValueOnce(null);
    create.mockResolvedValueOnce(fakeProvider({ apiKeyEncrypted: 'gcm:v1:mocked' }));
    const createRes = await svc.create(createDto);
    expect(createRes).not.toHaveProperty('apiKeyEncrypted');
    expect(createRes.hasApiKey).toBe(true);
    expect(JSON.stringify(createRes)).not.toContain('gcm:v1:mocked');

    findUnique.mockResolvedValueOnce(fakeProvider());
    update.mockResolvedValueOnce(fakeProvider({ apiKeyEncrypted: 'gcm:v1:mocked' }));
    const updateRes = await svc.update('p1', { apiKey: 'new-secret' });
    expect(updateRes).not.toHaveProperty('apiKeyEncrypted');
    expect(updateRes.hasApiKey).toBe(true);
    expect(JSON.stringify(updateRes)).not.toContain('gcm:v1:mocked');
  });

  it('(c) update с apiKey:null очищает apiKeyEncrypted в Prisma update', async () => {
    findUnique.mockResolvedValueOnce(fakeProvider({ apiKeyEncrypted: 'gcm:v1:old' }));
    update.mockResolvedValueOnce(fakeProvider({ apiKeyEncrypted: null }));

    await svc.update('p1', { apiKey: null });

    expect(encrypt).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ apiKeyEncrypted: null }),
      }),
    );
  });

  it('(d) update без поля apiKey (undefined) не трогает apiKeyEncrypted в data', async () => {
    findUnique.mockResolvedValueOnce(fakeProvider({ apiKeyEncrypted: 'gcm:v1:old' }));
    update.mockResolvedValueOnce(fakeProvider({ apiKeyEncrypted: 'gcm:v1:old' }));

    await svc.update('p1', { displayName: 'DeepSeek v2' });

    expect(encrypt).not.toHaveBeenCalled();
    const callArg = update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(callArg.data).not.toHaveProperty('apiKeyEncrypted');
  });

  it('(e) update с apiKey:"" (пустая строка) не трогает apiKeyEncrypted в data', async () => {
    findUnique.mockResolvedValueOnce(fakeProvider({ apiKeyEncrypted: 'gcm:v1:old' }));
    update.mockResolvedValueOnce(fakeProvider({ apiKeyEncrypted: 'gcm:v1:old' }));

    await svc.update('p1', { apiKey: '' });

    expect(encrypt).not.toHaveBeenCalled();
    const callArg = update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(callArg.data).not.toHaveProperty('apiKeyEncrypted');
  });

  it('getById бросает NotFoundException provider_not_found для отсутствующей/soft-deleted строки', async () => {
    findUnique.mockResolvedValueOnce(null);

    let err: unknown;
    try {
      await svc.getById('missing');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(NotFoundException);
    expect((err as NotFoundException).getResponse()).toMatchObject({
      error: { code: 'provider_not_found' },
    });
  });

  it('softDeleteWithFallback (без reassign, дефолт не назначен) soft-удаляет и инвалидирует providerInfo-кэш (нет ссылок в маршрутах)', async () => {
    findUnique.mockResolvedValueOnce(fakeProvider());
    llmTaskRouteFindFirst.mockResolvedValueOnce(null);
    llmProviderFindFirst.mockResolvedValueOnce(null);
    update.mockResolvedValueOnce(fakeProvider({ deletedAt: FIXED_DATE, isActive: false }));

    const res = await svc.softDeleteWithFallback('p1', undefined, 'user-1');

    expect(res).toEqual({ ok: true, routesMigrated: 0 });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ isActive: false }),
      }),
    );
    expect(invalidate).toHaveBeenCalled();
  });

  describe('provider_in_use_by_routes гард (Ф6, регрессия — см. также softDeleteWithFallback (e))', () => {
    it('update({isActive:false}) провайдера в llm.router.defaultChain → ConflictException', async () => {
      const svcWithCfg = new AdminLlmProvidersService(prisma, crypto, providerInfo, cfg);
      findUnique.mockResolvedValueOnce(fakeProvider());
      llmTaskRouteFindFirst.mockResolvedValueOnce(null);
      getDynamic.mockResolvedValueOnce([
        { provider: 'deepseek' },
        { provider: 'openai-via-proxy' },
      ]);

      let err: unknown;
      try {
        await svcWithCfg.update('p1', { isActive: false });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toMatchObject({
        error: { code: 'provider_in_use_by_routes' },
      });
      expect(update).not.toHaveBeenCalled();
    });

    it('update({isActive:false}) провайдера вне маршрутов и defaultChain — проходит', async () => {
      const svcWithCfg = new AdminLlmProvidersService(prisma, crypto, providerInfo, cfg);
      findUnique.mockResolvedValueOnce(fakeProvider());
      llmTaskRouteFindFirst.mockResolvedValueOnce(null);
      getDynamic.mockResolvedValueOnce([{ provider: 'openai-via-proxy' }]);
      update.mockResolvedValueOnce(fakeProvider({ isActive: false }));

      const res = await svcWithCfg.update('p1', { isActive: false });
      expect(res.isActive).toBe(false);
    });
  });

  describe('discoverModels', () => {
    it('(a) успех: resolveByName даёт effective baseUrl/apiKey, discoverProviderModels — 2 модели, одна уже в каталоге', async () => {
      findUnique.mockResolvedValueOnce(fakeProvider({ protocolKind: 'openai-chat' }));
      resolveByName.mockResolvedValueOnce({
        info: { baseUrl: 'https://x', apiKey: 'k' },
        protocolKind: 'openai-chat',
      });
      llmModelFindMany.mockResolvedValueOnce([{ modelKey: 'm1' }]);
      vi.mocked(discoverProviderModels).mockResolvedValueOnce([{ id: 'm1' }, { id: 'm2' }]);

      const res = await svc.discoverModels('p1');

      expect(resolveByName).toHaveBeenCalledWith('deepseek');
      expect(discoverProviderModels).toHaveBeenCalledWith(
        expect.objectContaining({ baseUrl: 'https://x', apiKey: 'k' }),
      );
      expect(res).toEqual({
        ok: true,
        models: [
          { id: 'm1', alreadyInCatalog: true },
          { id: 'm2', alreadyInCatalog: false },
        ],
      });
    });

    it('(b) protocolKind=anthropic-messages → бросает BadRequestException discovery_not_supported', async () => {
      findUnique.mockResolvedValueOnce(fakeProvider({ protocolKind: 'anthropic-messages' }));

      let err: unknown;
      try {
        await svc.discoverModels('p1');
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toMatchObject({
        error: { code: 'discovery_not_supported' },
      });
      expect(discoverProviderModels).not.toHaveBeenCalled();
    });

    it('(c) discoverProviderModels бросает → {ok:false, error} без throw наружу', async () => {
      findUnique.mockResolvedValueOnce(fakeProvider({ protocolKind: 'openai-chat' }));
      resolveByName.mockResolvedValueOnce(null);
      vi.mocked(discoverProviderModels).mockRejectedValueOnce(new Error('boom'));

      const res = await svc.discoverModels('p1');

      expect(res).toEqual({ ok: false, error: 'boom' });
    });
  });

  describe('connectionMeta', () => {
    const cfgWithProxy = {
      getDynamic,
      ai: { proxy: { baseUrl: 'https://proxy.agent-lia.ru/v1', prefix: 'myFeedproxy3128' } },
    } as unknown as ConstructorParameters<typeof AdminLlmProvidersService>[3];

    it('(a) отдаёт адрес прокси и маску префикса (первые 4 символа + …)', () => {
      const withCfg = new AdminLlmProvidersService(prisma, crypto, providerInfo, cfgWithProxy);

      expect(withCfg.connectionMeta()).toEqual({
        proxyBaseUrl: 'https://proxy.agent-lia.ru/v1',
        proxyKeyPrefixMask: 'myFe…',
      });
    });

    it('(b) без cfg → оба поля null', () => {
      expect(svc.connectionMeta()).toEqual({ proxyBaseUrl: null, proxyKeyPrefixMask: null });
    });
  });

  describe('discoverModelsPreview через прокси', () => {
    const cfgWithProxy = {
      getDynamic,
      ai: { proxy: { baseUrl: 'https://proxy.agent-lia.ru/v1', prefix: 'myFeedproxy3128' } },
    } as unknown as ConstructorParameters<typeof AdminLlmProvidersService>[3];

    it('(a) useProxy=true, proxyPath=null → GET на адрес прокси с ключом с префиксом', async () => {
      const withCfg = new AdminLlmProvidersService(prisma, crypto, providerInfo, cfgWithProxy);
      vi.mocked(discoverProviderModels).mockResolvedValueOnce([{ id: 'gpt-5-mini' }]);

      const res = await withCfg.discoverModelsPreview({
        baseUrl: 'https://api.openai.com/v1',
        protocolKind: 'openai-chat',
        apiKey: 'sk-x',
        useProxy: true,
        proxyPath: null,
      });

      expect(discoverProviderModels).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: 'https://proxy.agent-lia.ru/v1',
          apiKey: 'myFeedproxy3128:sk-x',
        }),
      );
      expect(res).toEqual({ ok: true, models: [{ id: 'gpt-5-mini' }] });
    });

    it('(b) useProxy=true, proxyPath="grsai" → корень прокси + слаг + /v1', async () => {
      const withCfg = new AdminLlmProvidersService(prisma, crypto, providerInfo, cfgWithProxy);
      vi.mocked(discoverProviderModels).mockResolvedValueOnce([]);

      await withCfg.discoverModelsPreview({
        baseUrl: 'https://grsaiapi.com',
        protocolKind: 'grsai-native',
        apiKey: 'sk-x',
        useProxy: true,
        proxyPath: 'grsai',
      });

      expect(discoverProviderModels).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: 'https://proxy.agent-lia.ru/grsai/v1',
          apiKey: 'myFeedproxy3128:sk-x',
        }),
      );
    });

    it('(c) useProxy=false → baseUrl/apiKey из формы без изменений', async () => {
      const withCfg = new AdminLlmProvidersService(prisma, crypto, providerInfo, cfgWithProxy);
      vi.mocked(discoverProviderModels).mockResolvedValueOnce([]);

      await withCfg.discoverModelsPreview({
        baseUrl: 'https://api.deepseek.com/v1',
        protocolKind: 'openai-chat',
        apiKey: 'sk-x',
      });

      expect(discoverProviderModels).toHaveBeenCalledWith(
        expect.objectContaining({ baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-x' }),
      );
    });

    it('(d) useProxy=true без cfg → {ok:false} с понятной ошибкой, без сетевого вызова', async () => {
      const res = await svc.discoverModelsPreview({
        baseUrl: 'https://api.openai.com/v1',
        protocolKind: 'openai-chat',
        apiKey: 'sk-x',
        useProxy: true,
      });

      expect(res).toEqual({
        ok: false,
        error: 'Прокси не сконфигурирован на сервере (PROXY_BASE_URL / PROXY_PREFIX)',
      });
      expect(discoverProviderModels).not.toHaveBeenCalled();
    });
  });

  describe('setDefaultProvider (Ф2026-07-06 llm-provider-default-fallback, Фаза 1)', () => {
    it('(a) назначить А дефолтом, потом Б → транзакция каждый раз сбрасывает старый флаг и ставит новый + модель', async () => {
      findUnique.mockResolvedValueOnce(fakeProvider({ id: 'pA', name: 'anthropic' }));
      llmModelFindFirst.mockResolvedValueOnce({
        id: 'm1',
        providerId: 'pA',
        modelKey: 'model-a',
        isActive: true,
        deletedAt: null,
      });
      updateMany.mockResolvedValueOnce({ count: 0 });
      update.mockResolvedValueOnce(
        fakeProvider({
          id: 'pA',
          name: 'anthropic',
          isDefaultProvider: true,
          defaultModelKey: 'model-a',
        }),
      );

      const resA = await svc.setDefaultProvider('pA', 'model-a', 'user-1');

      expect(resA).toEqual({ ok: true });
      expect(updateMany).toHaveBeenNthCalledWith(1, {
        where: { isDefaultProvider: true },
        data: { isDefaultProvider: false },
      });
      expect(update).toHaveBeenNthCalledWith(1, {
        where: { id: 'pA' },
        data: { isDefaultProvider: true, defaultModelKey: 'model-a' },
      });
      expect(invalidate).toHaveBeenCalledTimes(1);

      findUnique.mockResolvedValueOnce(fakeProvider({ id: 'pB', name: 'deepseek' }));
      llmModelFindFirst.mockResolvedValueOnce({
        id: 'm2',
        providerId: 'pB',
        modelKey: 'model-b',
        isActive: true,
        deletedAt: null,
      });
      updateMany.mockResolvedValueOnce({ count: 1 });
      update.mockResolvedValueOnce(
        fakeProvider({
          id: 'pB',
          name: 'deepseek',
          isDefaultProvider: true,
          defaultModelKey: 'model-b',
        }),
      );

      const resB = await svc.setDefaultProvider('pB', 'model-b', 'user-1');

      expect(resB).toEqual({ ok: true });
      expect(updateMany).toHaveBeenNthCalledWith(2, {
        where: { isDefaultProvider: true },
        data: { isDefaultProvider: false },
      });
      expect(update).toHaveBeenNthCalledWith(2, {
        where: { id: 'pB' },
        data: { isDefaultProvider: true, defaultModelKey: 'model-b' },
      });
      expect(invalidate).toHaveBeenCalledTimes(2);
    });

    it('(b) модель не принадлежит провайдеру / не активна → UnprocessableEntityException default_model_invalid', async () => {
      findUnique.mockResolvedValueOnce(fakeProvider({ id: 'p1', name: 'deepseek' }));
      llmModelFindFirst.mockResolvedValueOnce(null);

      let err: unknown;
      try {
        await svc.setDefaultProvider('p1', 'bad-model', 'user-1');
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect((err as UnprocessableEntityException).getResponse()).toMatchObject({
        error: { code: 'default_model_invalid' },
      });
      expect(transaction).not.toHaveBeenCalled();
      expect(invalidate).not.toHaveBeenCalled();
    });

    it('(c) ставит нового дефолт-провайдера в начало llm.router.defaultChain через adminSettings.set (ensureDefaultChainPrimary)', async () => {
      const svcFull = new AdminLlmProvidersService(
        prisma,
        crypto,
        providerInfo,
        cfg,
        router,
        adminSettings,
      );
      findUnique.mockResolvedValueOnce(fakeProvider({ id: 'pB', name: 'deepseek' }));
      llmModelFindFirst.mockResolvedValueOnce({
        id: 'm2',
        providerId: 'pB',
        modelKey: 'model-b',
        isActive: true,
        deletedAt: null,
      });
      updateMany.mockResolvedValueOnce({ count: 1 });
      update.mockResolvedValueOnce(
        fakeProvider({
          id: 'pB',
          name: 'deepseek',
          isDefaultProvider: true,
          defaultModelKey: 'model-b',
        }),
      );
      getDynamic.mockResolvedValueOnce([
        { provider: 'anthropic', model: 'claude-x' },
      ]);

      await svcFull.setDefaultProvider('pB', 'model-b', 'user-7');

      expect(adminSettingsSet).toHaveBeenCalledWith(
        'llm.router.defaultChain',
        [
          { provider: 'deepseek', model: 'model-b' },
          { provider: 'anthropic', model: 'claude-x' },
        ],
        { userId: 'user-7', reason: 'default_provider_set' },
      );
      expect(refreshCache).toHaveBeenCalledTimes(1);
    });

    it('(d) не перезаписывает defaultChain, если провайдер уже primary в нём', async () => {
      const svcFull = new AdminLlmProvidersService(
        prisma,
        crypto,
        providerInfo,
        cfg,
        router,
        adminSettings,
      );
      findUnique.mockResolvedValueOnce(fakeProvider({ id: 'pB', name: 'deepseek' }));
      llmModelFindFirst.mockResolvedValueOnce({
        id: 'm2',
        providerId: 'pB',
        modelKey: 'model-b',
        isActive: true,
        deletedAt: null,
      });
      updateMany.mockResolvedValueOnce({ count: 1 });
      update.mockResolvedValueOnce(
        fakeProvider({
          id: 'pB',
          name: 'deepseek',
          isDefaultProvider: true,
          defaultModelKey: 'model-b',
        }),
      );
      getDynamic.mockResolvedValueOnce([
        { provider: 'deepseek', model: 'model-b' },
        { provider: 'anthropic', model: 'claude-x' },
      ]);

      await svcFull.setDefaultProvider('pB', 'model-b', 'user-7');

      expect(adminSettingsSet).not.toHaveBeenCalled();
    });
  });

  describe('previewRemoval (Ф2026-07-06 llm-provider-default-fallback, Фаза 1)', () => {
    it('(a) занят в глобальном тир-маршруте + per-tenant тир-маршруте + legacy JSON-маршруте → считает все три, tenants дедуп по __global__/tenantId', async () => {
      const svcWithCfg = new AdminLlmProvidersService(prisma, crypto, providerInfo, cfg);
      findUnique.mockResolvedValueOnce(
        fakeProvider({ id: 'p1', name: 'deepseek', isDefaultProvider: false }),
      );
      llmTaskRouteFindMany
        .mockResolvedValueOnce([{ tenantId: null }, { tenantId: 'org1' }])
        .mockResolvedValueOnce([
          { tenantId: 'org2', providers: [{ provider: 'deepseek' }] },
          { tenantId: 'org3', providers: [{ provider: 'openai-via-proxy' }] },
        ]);
      getDynamic.mockResolvedValueOnce([{ provider: 'deepseek' }]);
      llmProviderFindFirst.mockResolvedValueOnce(
        fakeProvider({
          id: 'pDefault',
          name: 'ollama',
          isDefaultProvider: true,
          defaultModelKey: 'qwen3.5:9b',
        }),
      );

      const res = await svcWithCfg.previewRemoval('p1');

      expect(res).toEqual({
        providerName: 'deepseek',
        isDefault: false,
        affectedRoutesCount: 3,
        affectedTenantsCount: 3,
        inDefaultChain: true,
        currentDefault: { providerName: 'ollama', model: 'qwen3.5:9b' },
      });
    });

    it('(b) провайдер не занят нигде → affectedRoutesCount:0, affectedTenantsCount:0, inDefaultChain:false, currentDefault:null', async () => {
      const svcWithCfg = new AdminLlmProvidersService(prisma, crypto, providerInfo, cfg);
      findUnique.mockResolvedValueOnce(fakeProvider({ id: 'p1', name: 'unused-provider' }));
      llmTaskRouteFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      getDynamic.mockResolvedValueOnce([{ provider: 'deepseek' }]);
      llmProviderFindFirst.mockResolvedValueOnce(null);

      const res = await svcWithCfg.previewRemoval('p1');

      expect(res).toEqual({
        providerName: 'unused-provider',
        isDefault: false,
        affectedRoutesCount: 0,
        affectedTenantsCount: 0,
        inDefaultChain: false,
        currentDefault: null,
      });
    });
  });

  describe('softDeleteWithFallback (Ф2026-07-06 llm-provider-default-fallback, Фаза 2)', () => {
    it('(a) занят в 1 глобальном тир-маршруте, дефолт назначен → маршрут переключён на дефолт, audit-запись создана', async () => {
      const svcFull = new AdminLlmProvidersService(
        prisma,
        crypto,
        providerInfo,
        cfg,
        router,
        adminSettings,
      );
      findUnique.mockResolvedValueOnce(
        fakeProvider({ id: 'p1', name: 'openai-via-proxy', isDefaultProvider: false }),
      );
      llmProviderFindFirst.mockResolvedValueOnce(
        fakeProvider({
          id: 'pDefault',
          name: 'deepseek',
          isDefaultProvider: true,
          defaultModelKey: 'deepseek-v4-flash',
        }),
      );
      llmTaskRouteFindMany
        .mockResolvedValueOnce([
          {
            id: 'r1',
            taskType: 'summary',
            tenantId: null,
            tier: 'primary',
            providerName: 'openai-via-proxy',
            model: 'gpt-5-mini',
          },
        ])
        .mockResolvedValueOnce([]);
      getDynamic.mockResolvedValueOnce([]);
      update.mockResolvedValueOnce(fakeProvider({ id: 'p1', deletedAt: FIXED_DATE, isActive: false }));

      const res = await svcFull.softDeleteWithFallback('p1', undefined, 'user1');

      expect(res).toEqual({ ok: true, routesMigrated: 1 });
      expect(llmTaskRouteUpdate).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { providerName: 'deepseek', model: 'deepseek-v4-flash' },
      });
      expect(llmTaskRouteDelete).not.toHaveBeenCalled();
      expect(llmTaskRouteChangeCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          taskType: 'summary',
          tenantId: null,
          tier: 'primary',
          changeType: 'removed_provider',
          before: { providerName: 'openai-via-proxy', model: 'gpt-5-mini' },
          after: { providerName: 'deepseek', model: 'deepseek-v4-flash' },
          changedById: 'user1',
          reason: 'provider_deleted_auto_migrated',
        }),
      });
      expect(update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { deletedAt: expect.any(Date), isActive: false },
      });
      expect(invalidate).toHaveBeenCalled();
      expect(refreshCache).toHaveBeenCalled();
    });

    it('(b) занят в per-tenant тир-маршруте (Р4) → тоже мигрирует, audit-запись с тем же tenantId', async () => {
      const svcFull = new AdminLlmProvidersService(
        prisma,
        crypto,
        providerInfo,
        cfg,
        router,
        adminSettings,
      );
      findUnique.mockResolvedValueOnce(
        fakeProvider({ id: 'p1', name: 'openai-via-proxy', isDefaultProvider: false }),
      );
      llmProviderFindFirst.mockResolvedValueOnce(
        fakeProvider({
          id: 'pDefault',
          name: 'deepseek',
          isDefaultProvider: true,
          defaultModelKey: 'deepseek-v4-flash',
        }),
      );
      llmTaskRouteFindMany
        .mockResolvedValueOnce([
          {
            id: 'r-org1',
            taskType: 'summary',
            tenantId: 'org1',
            tier: 'secondary',
            providerName: 'openai-via-proxy',
            model: 'gpt-5-mini',
          },
        ])
        .mockResolvedValueOnce([]);
      getDynamic.mockResolvedValueOnce([]);
      update.mockResolvedValueOnce(fakeProvider({ id: 'p1', deletedAt: FIXED_DATE, isActive: false }));

      const res = await svcFull.softDeleteWithFallback('p1', undefined, 'user1');

      expect(res).toEqual({ ok: true, routesMigrated: 1 });
      expect(llmTaskRouteUpdate).toHaveBeenCalledWith({
        where: { id: 'r-org1' },
        data: { providerName: 'deepseek', model: 'deepseek-v4-flash' },
      });
      expect(llmTaskRouteChangeCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ tenantId: 'org1', tier: 'secondary' }),
      });
    });

    it('(c) занят в legacy JSON-массиве → элемент массива заменён на дефолт', async () => {
      const svcFull = new AdminLlmProvidersService(
        prisma,
        crypto,
        providerInfo,
        cfg,
        router,
        adminSettings,
      );
      findUnique.mockResolvedValueOnce(
        fakeProvider({ id: 'p1', name: 'openai-via-proxy', isDefaultProvider: false }),
      );
      llmProviderFindFirst.mockResolvedValueOnce(
        fakeProvider({
          id: 'pDefault',
          name: 'deepseek',
          isDefaultProvider: true,
          defaultModelKey: 'deepseek-v4-flash',
        }),
      );
      llmTaskRouteFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          id: 'legacy1',
          taskType: 'chat',
          tenantId: null,
          tier: null,
          providers: [{ provider: 'openai-via-proxy', model: 'gpt-5-mini' }, { provider: 'anthropic' }],
        },
      ]);
      getDynamic.mockResolvedValueOnce([]);
      update.mockResolvedValueOnce(fakeProvider({ id: 'p1', deletedAt: FIXED_DATE, isActive: false }));

      const res = await svcFull.softDeleteWithFallback('p1', undefined, 'user1');

      expect(res).toEqual({ ok: true, routesMigrated: 1 });
      expect(llmTaskRouteUpdate).toHaveBeenCalledWith({
        where: { id: 'legacy1' },
        data: {
          providers: [{ provider: 'deepseek', model: 'deepseek-v4-flash' }, { provider: 'anthropic' }],
        },
      });
      expect(llmTaskRouteChangeCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ taskType: 'chat', tenantId: null, tier: null }),
      });
    });

    it('(d) дефолт уже стоит в той же цепочке на другом тире (регрессия инцидента 2026-07-06) → мигрирующий тир ВСЁ РАВНО переключается на дефолт, не удаляется', async () => {
      const svcFull = new AdminLlmProvidersService(
        prisma,
        crypto,
        providerInfo,
        cfg,
        router,
        adminSettings,
      );
      findUnique.mockResolvedValueOnce(
        fakeProvider({ id: 'p1', name: 'openai-via-proxy', isDefaultProvider: false }),
      );
      llmProviderFindFirst.mockResolvedValueOnce(
        fakeProvider({
          id: 'pDefault',
          name: 'deepseek',
          isDefaultProvider: true,
          defaultModelKey: 'deepseek-v4-flash',
        }),
      );
      llmTaskRouteFindMany
        .mockResolvedValueOnce([
          {
            id: 'r1',
            taskType: 'summary',
            tenantId: null,
            tier: 'primary',
            providerName: 'openai-via-proxy',
            model: 'gpt-5-mini',
          },
        ])
        .mockResolvedValueOnce([]);
      getDynamic.mockResolvedValueOnce([]);
      update.mockResolvedValueOnce(fakeProvider({ id: 'p1', deletedAt: FIXED_DATE, isActive: false }));

      const res = await svcFull.softDeleteWithFallback('p1', undefined, 'user1');

      expect(res).toEqual({ ok: true, routesMigrated: 1 });
      expect(llmTaskRouteUpdate).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { providerName: 'deepseek', model: 'deepseek-v4-flash' },
      });
      expect(llmTaskRouteDelete).not.toHaveBeenCalled();
    });

    it('(e) дефолт НЕ назначен → удаление занятого провайдера по-прежнему бросает provider_in_use_by_routes (регрессия недопустима)', async () => {
      const svcFull = new AdminLlmProvidersService(
        prisma,
        crypto,
        providerInfo,
        cfg,
        router,
        adminSettings,
      );
      findUnique.mockResolvedValueOnce(
        fakeProvider({ id: 'p1', name: 'openai-via-proxy', isDefaultProvider: false }),
      );
      llmProviderFindFirst.mockResolvedValueOnce(null);
      llmTaskRouteFindFirst.mockResolvedValueOnce({ taskType: 'summary' });

      let err: unknown;
      try {
        await svcFull.softDeleteWithFallback('p1', undefined, 'user1');
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toMatchObject({
        error: { code: 'provider_in_use_by_routes' },
      });
      expect(update).not.toHaveBeenCalled();
      expect(refreshCache).not.toHaveBeenCalled();
    });

    it('(f) удаление самого дефолтного провайдера БЕЗ reassignDefaultTo → ConflictException must_reassign_default', async () => {
      const svcFull = new AdminLlmProvidersService(
        prisma,
        crypto,
        providerInfo,
        cfg,
        router,
        adminSettings,
      );
      findUnique.mockResolvedValueOnce(
        fakeProvider({ id: 'p1', name: 'deepseek', isDefaultProvider: true }),
      );

      let err: unknown;
      try {
        await svcFull.softDeleteWithFallback('p1', undefined, 'user1');
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toMatchObject({
        error: { code: 'must_reassign_default' },
      });
      expect(llmModelFindFirst).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    it('(g) удаление дефолтного провайдера С reassignDefaultTo → новый провайдер становится дефолтом, миграция идёт на НОВЫЙ дефолт (не на старый), старый помечен deletedAt', async () => {
      const svcFull = new AdminLlmProvidersService(
        prisma,
        crypto,
        providerInfo,
        cfg,
        router,
        adminSettings,
      );
      findUnique
        .mockResolvedValueOnce(fakeProvider({ id: 'p1', name: 'deepseek', isDefaultProvider: true }))
        .mockResolvedValueOnce(
          fakeProvider({ id: 'p2', name: 'openai-via-proxy', isDefaultProvider: false }),
        );
      llmModelFindFirst.mockResolvedValueOnce({
        id: 'm2',
        providerId: 'p2',
        modelKey: 'gpt-5-mini',
        isActive: true,
        deletedAt: null,
      });
      updateMany.mockResolvedValueOnce({ count: 1 });
      update.mockResolvedValueOnce(
        fakeProvider({
          id: 'p2',
          name: 'openai-via-proxy',
          isDefaultProvider: true,
          defaultModelKey: 'gpt-5-mini',
        }),
      );
      llmProviderFindFirst.mockResolvedValueOnce(
        fakeProvider({
          id: 'p2',
          name: 'openai-via-proxy',
          isDefaultProvider: true,
          defaultModelKey: 'gpt-5-mini',
        }),
      );
      llmTaskRouteFindMany
        .mockResolvedValueOnce([
          {
            id: 'r1',
            taskType: 'summary',
            tenantId: null,
            tier: 'primary',
            providerName: 'deepseek',
            model: 'deepseek-v4-flash',
          },
        ])
        .mockResolvedValueOnce([]);
      llmTaskRouteFindFirst.mockResolvedValueOnce(null);
      getDynamic.mockResolvedValueOnce([]);
      update.mockResolvedValueOnce(fakeProvider({ id: 'p1', deletedAt: FIXED_DATE, isActive: false }));

      const res = await svcFull.softDeleteWithFallback(
        'p1',
        { providerId: 'p2', model: 'gpt-5-mini' },
        'user1',
      );

      expect(res).toEqual({ ok: true, routesMigrated: 1 });
      expect(update).toHaveBeenNthCalledWith(1, {
        where: { id: 'p2' },
        data: { isDefaultProvider: true, defaultModelKey: 'gpt-5-mini' },
      });
      expect(llmTaskRouteUpdate).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { providerName: 'openai-via-proxy', model: 'gpt-5-mini' },
      });
      expect(update).toHaveBeenNthCalledWith(2, {
        where: { id: 'p1' },
        data: { deletedAt: expect.any(Date), isActive: false },
      });
    });

    it('(h) провайдер в llm.router.defaultChain → после удаления в массиве стоит дефолт вместо старого, сохранено через AdminSettingsService.set', async () => {
      const svcFull = new AdminLlmProvidersService(
        prisma,
        crypto,
        providerInfo,
        cfg,
        router,
        adminSettings,
      );
      findUnique.mockResolvedValueOnce(
        fakeProvider({ id: 'p1', name: 'openai-via-proxy', isDefaultProvider: false }),
      );
      llmProviderFindFirst.mockResolvedValueOnce(
        fakeProvider({
          id: 'pDefault',
          name: 'deepseek',
          isDefaultProvider: true,
          defaultModelKey: 'deepseek-v4-flash',
        }),
      );
      llmTaskRouteFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      getDynamic.mockResolvedValueOnce([
        { provider: 'openai-via-proxy', model: 'gpt-5-mini' },
        { provider: 'anthropic' },
      ]);
      update.mockResolvedValueOnce(fakeProvider({ id: 'p1', deletedAt: FIXED_DATE, isActive: false }));

      const res = await svcFull.softDeleteWithFallback('p1', undefined, 'user1');

      expect(res).toEqual({ ok: true, routesMigrated: 0 });
      expect(adminSettingsSet).toHaveBeenCalledWith(
        'llm.router.defaultChain',
        [{ provider: 'deepseek', model: 'deepseek-v4-flash' }, { provider: 'anthropic' }],
        { userId: 'user1', reason: 'provider_deleted_auto_migrated' },
      );
    });

    it('(i) AdminSettingsService не инжектирован (undefined) → фолбэк на прямой prisma.adminSetting.upsert', async () => {
      const svcNoAdminSettings = new AdminLlmProvidersService(
        prisma,
        crypto,
        providerInfo,
        cfg,
        router,
      );
      findUnique.mockResolvedValueOnce(
        fakeProvider({ id: 'p1', name: 'openai-via-proxy', isDefaultProvider: false }),
      );
      llmProviderFindFirst.mockResolvedValueOnce(
        fakeProvider({
          id: 'pDefault',
          name: 'deepseek',
          isDefaultProvider: true,
          defaultModelKey: 'deepseek-v4-flash',
        }),
      );
      llmTaskRouteFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      getDynamic.mockResolvedValueOnce([{ provider: 'openai-via-proxy' }]);
      update.mockResolvedValueOnce(fakeProvider({ id: 'p1', deletedAt: FIXED_DATE, isActive: false }));

      await svcNoAdminSettings.softDeleteWithFallback('p1', undefined, 'user1');

      expect(adminSettingsSet).not.toHaveBeenCalled();
      expect(adminSettingUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'llm.router.defaultChain' },
          update: expect.objectContaining({ value: [{ provider: 'deepseek', model: 'deepseek-v4-flash' }] }),
        }),
      );
    });
  });

  describe('billingMode=subscription (ТЗ 2026-07-06 llm-provider-subscription-billing)', () => {
    it('(a) create с billingMode=subscription без subscriptionMonthlyCostUsd/subscriptionStartedAt → 422 subscription_fields_required', async () => {
      let err: unknown;
      try {
        await svc.create({ ...createDto, name: 'minimaxio2', billingMode: 'subscription' });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect((err as UnprocessableEntityException).getResponse()).toMatchObject({
        error: { code: 'subscription_fields_required' },
      });
      expect(create).not.toHaveBeenCalled();
    });

    it('(b) create с billingMode=subscription + оба поля заданы → создаёт, present() возвращает поля', async () => {
      findUnique.mockResolvedValueOnce(null);
      create.mockResolvedValueOnce(
        fakeProvider({
          name: 'minimaxio2',
          billingMode: 'subscription',
          subscriptionMonthlyCostUsd: new Prisma.Decimal(50),
          subscriptionStartedAt: new Date('2026-07-01T00:00:00.000Z'),
        }),
      );

      const res = await svc.create({
        ...createDto,
        name: 'minimaxio2',
        billingMode: 'subscription',
        subscriptionMonthlyCostUsd: 50,
        subscriptionStartedAt: '2026-07-01T00:00:00.000Z',
      });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            billingMode: 'subscription',
            subscriptionMonthlyCostUsd: 50,
            subscriptionStartedAt: new Date('2026-07-01T00:00:00.000Z'),
          }),
        }),
      );
      expect(res.billingMode).toBe('subscription');
      expect(res.subscriptionMonthlyCostUsd).toBe(50);
      expect(res.subscriptionStartedAt).toBe('2026-07-01T00:00:00.000Z');
    });

    it('(c) update({billingMode:"subscription"}) без указания сумм/даты, но существующий провайдер их уже имеет → проходит (эффективные значения из БД)', async () => {
      findUnique.mockResolvedValueOnce(
        fakeProvider({
          billingMode: 'per_token',
          subscriptionMonthlyCostUsd: new Prisma.Decimal(50),
          subscriptionStartedAt: new Date('2026-07-01T00:00:00.000Z'),
        }),
      );
      llmTaskRouteFindFirst.mockResolvedValueOnce(null);
      update.mockResolvedValueOnce(fakeProvider({ billingMode: 'subscription' }));

      const res = await svc.update('p1', { billingMode: 'subscription' });

      expect(res.billingMode).toBe('subscription');
    });

    it('(d) update({billingMode:"subscription"}) у провайдера без ранее заданных сумм/даты → 422', async () => {
      findUnique.mockResolvedValueOnce(fakeProvider({ billingMode: 'per_token' }));

      let err: unknown;
      try {
        await svc.update('p1', { billingMode: 'subscription' });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect((err as UnprocessableEntityException).getResponse()).toMatchObject({
        error: { code: 'subscription_fields_required' },
      });
      expect(update).not.toHaveBeenCalled();
    });
  });
});
