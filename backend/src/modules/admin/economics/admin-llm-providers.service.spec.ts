import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
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
    useProxy: false,
    proxyPath: null,
    timeoutMs: null,
    defaultModelKey: null,
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
  const llmModelFindMany = vi.fn();
  const llmTaskRouteFindFirst = vi.fn();
  const encrypt = vi.fn(() => 'gcm:v1:mocked');
  const isEncrypted = vi.fn((v: string) => v.startsWith('gcm:v1:'));
  const invalidate = vi.fn();
  const resolveByName = vi.fn();
  const getDynamic = vi.fn();

  const prisma = {
    llmProvider: { findMany, findUnique, create, update },
    llmModel: { findMany: llmModelFindMany },
    llmTaskRoute: { findFirst: llmTaskRouteFindFirst },
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

  let svc: AdminLlmProvidersService;

  beforeEach(() => {
    vi.clearAllMocks();
    encrypt.mockReturnValue('gcm:v1:mocked');
    llmModelFindMany.mockResolvedValue([]);
    llmTaskRouteFindFirst.mockResolvedValue(null);
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

  it('softDelete soft-удаляет и инвалидирует providerInfo-кэш (нет ссылок в маршрутах)', async () => {
    findUnique.mockResolvedValueOnce(fakeProvider());
    llmTaskRouteFindFirst.mockResolvedValueOnce(null);
    update.mockResolvedValueOnce(fakeProvider({ deletedAt: FIXED_DATE, isActive: false }));

    const res = await svc.softDelete('p1');

    expect(res).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ isActive: false }),
      }),
    );
    expect(invalidate).toHaveBeenCalled();
  });

  describe('provider_in_use_by_routes гард (Ф6)', () => {
    it('softDelete провайдера с активным маршрутом → ConflictException, llmProvider.update НЕ вызван', async () => {
      findUnique.mockResolvedValueOnce(fakeProvider());
      llmTaskRouteFindFirst.mockResolvedValueOnce({ taskType: 'summary' });

      let err: unknown;
      try {
        await svc.softDelete('p1');
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toMatchObject({
        error: { code: 'provider_in_use_by_routes' },
      });
      expect(update).not.toHaveBeenCalled();
    });

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
});
