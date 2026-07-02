import { ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminEmbeddingProvidersService } from './admin-embedding-providers.service';

vi.mock('../../embeddings/services/openai-compatible-embed.util', () => ({
  openaiCompatibleEmbed: vi.fn(),
}));

import { openaiCompatibleEmbed } from '../../embeddings/services/openai-compatible-embed.util';

const embedMock = vi.mocked(openaiCompatibleEmbed);

const FIXED_DATE = new Date('2026-01-01T00:00:00.000Z');

function fakeModel(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    providerId: 'p1',
    modelKey: 'embeddinggemma:latest',
    displayName: 'Gemma',
    dimensions: 768,
    pricePerMillionInputTokensKopecks: null,
    isActive: true,
    verifiedAt: null,
    notes: null,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    deletedAt: null,
    ...overrides,
  };
}

function fakeProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    name: 'local',
    displayName: 'Local',
    baseUrl: 'https://llm.korateam.ru/v1',
    protocolKind: 'ollama-embeddings',
    apiKeyEncrypted: null,
    defaultHeaders: null,
    isActive: true,
    priority: 10,
    needsReindex: false,
    lastSmokeAt: null,
    lastSmokeSuccess: null,
    lastSmokeError: null,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    deletedAt: null,
    models: [],
    ...overrides,
  };
}

describe('AdminEmbeddingProvidersService', () => {
  const findMany = vi.fn();
  const findUnique = vi.fn();
  const create = vi.fn();
  const update = vi.fn();
  const modelCreate = vi.fn();
  const modelFindFirst = vi.fn();
  const modelUpdate = vi.fn();
  const encrypt = vi.fn(() => 'gcm:enc');
  const decrypt = vi.fn(() => 'plainkey');

  const prisma = {
    embeddingProvider: { findMany, findUnique, create, update },
    embeddingModel: { create: modelCreate, findFirst: modelFindFirst, update: modelUpdate },
  } as unknown as ConstructorParameters<typeof AdminEmbeddingProvidersService>[0];
  const crypto = { encrypt, decrypt } as unknown as ConstructorParameters<
    typeof AdminEmbeddingProvidersService
  >[1];
  const cfg = { ai: { embeddings: { dimensions: 768 } } } as unknown as ConstructorParameters<
    typeof AdminEmbeddingProvidersService
  >[2];

  let svc: AdminEmbeddingProvidersService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new AdminEmbeddingProvidersService(prisma, crypto, cfg);
  });

  const createDto = {
    name: 'custom',
    displayName: 'Custom',
    baseUrl: 'https://custom/v1',
    protocolKind: 'openai-embeddings' as const,
    apiKey: 'secret',
    isActive: true,
    priority: 100,
  };

  it('(a) create с apiKey шифрует ключ через crypto.encrypt', async () => {
    findUnique.mockResolvedValueOnce(null);
    create.mockResolvedValueOnce(fakeProvider({ apiKeyEncrypted: 'gcm:enc' }));

    await svc.create(createDto);

    expect(encrypt).toHaveBeenCalledWith('secret');
    const callArg = create.mock.calls[0]![0] as { data: { apiKeyEncrypted?: string } };
    expect(callArg.data.apiKeyEncrypted).toBe('gcm:enc');
  });

  it('(b) create с дублем name бросает ConflictException embedding_provider_name_conflict', async () => {
    findUnique.mockResolvedValueOnce(fakeProvider());

    let err: unknown;
    try {
      await svc.create(createDto);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      error: { code: 'embedding_provider_name_conflict' },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('(c) activate с dimensions=1536 при cfg=768 бросает embedding_dimension_mismatch_requires_reindex', async () => {
    findUnique.mockResolvedValueOnce(
      fakeProvider({ models: [fakeModel({ dimensions: 1536, isActive: true })] }),
    );

    let err: unknown;
    try {
      await svc.activate('p1');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      error: { code: 'embedding_dimension_mismatch_requires_reindex' },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('(d) activate с dimensions=768==768 выставляет isActive=true', async () => {
    findUnique.mockResolvedValueOnce(
      fakeProvider({ models: [fakeModel({ dimensions: 768, isActive: true })] }),
    );
    update.mockResolvedValueOnce(
      fakeProvider({ isActive: true, models: [fakeModel({ dimensions: 768 })] }),
    );

    const res = await svc.activate('p1');

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1' }, data: { isActive: true } }),
    );
    expect(res.isActive).toBe(true);
  });

  it('(e) list маскирует ключ (hasApiKey=true, самого ключа нет в ответе)', async () => {
    findMany.mockResolvedValueOnce([fakeProvider({ apiKeyEncrypted: 'gcm:enc', models: [] })]);

    const res = await svc.list({ includeInactive: false });
    const item = res.items[0]!;

    expect(item.hasApiKey).toBe(true);
    expect(item).not.toHaveProperty('apiKeyEncrypted');
    expect(JSON.stringify(res)).not.toContain('gcm:enc');
  });

  it('(f) smoke ok → lastSmokeSuccess=true; smoke error → {ok:false} без throw', async () => {
    findUnique.mockResolvedValueOnce(
      fakeProvider({ apiKeyEncrypted: 'gcm:enc', models: [fakeModel({ isActive: true })] }),
    );
    embedMock.mockResolvedValueOnce([[0.1, 0.2]]);
    update.mockResolvedValueOnce(fakeProvider());

    const okRes = await svc.smoke('p1');
    expect(okRes).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastSmokeSuccess: true }) }),
    );

    vi.clearAllMocks();
    findUnique.mockResolvedValueOnce(
      fakeProvider({ models: [fakeModel({ isActive: true })] }),
    );
    embedMock.mockRejectedValueOnce(new Error('boom'));
    update.mockResolvedValueOnce(fakeProvider());

    const errRes = await svc.smoke('p1');
    expect(errRes).toEqual({ ok: false, error: 'boom' });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastSmokeSuccess: false, lastSmokeError: 'boom' }),
      }),
    );
  });
});
