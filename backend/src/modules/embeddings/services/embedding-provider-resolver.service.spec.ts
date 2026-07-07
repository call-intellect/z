import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CryptoService } from '../../../common/crypto/crypto.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { EmbeddingProviderResolverService } from './embedding-provider-resolver.service';

interface DbModel {
  modelKey: string;
  dimensions: number;
}
interface DbProvider {
  name: string;
  baseUrl: string;
  protocolKind: string;
  apiKeyEncrypted: string | null;
  models: DbModel[];
}

function makeResolver(providers: DbProvider[], decrypt?: CryptoService['decrypt']) {
  const findMany = vi.fn(async (_args?: unknown) => providers);
  const prisma = {
    embeddingProvider: { findMany },
  } as unknown as PrismaService;
  const crypto = {
    decrypt: decrypt ?? vi.fn((v: string) => `plain(${v})`),
  } as unknown as CryptoService;
  const svc = new EmbeddingProviderResolverService(prisma, crypto);
  return { svc, findMany, crypto };
}

describe('EmbeddingProviderResolverService.resolveChain', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('(a) 2 активных провайдера priority 10/20 → цепочка в порядке priority, model/dimensions из первой активной модели', async () => {
    const { svc, findMany } = makeResolver([
      {
        name: 'local',
        baseUrl: 'https://a.test/v1',
        protocolKind: 'ollama-embeddings',
        apiKeyEncrypted: null,
        models: [
          { modelKey: 'embeddinggemma:latest', dimensions: 768 },
          { modelKey: 'other', dimensions: 999 },
        ],
      },
      {
        name: 'openai-via-proxy',
        baseUrl: 'https://b.test/v1',
        protocolKind: 'openai-embeddings',
        apiKeyEncrypted: null,
        models: [{ modelKey: 'text-embedding-3-small', dimensions: 1536 }],
      },
    ]);

    const chain = await svc.resolveChain();

    expect(chain.map((c) => c.name)).toEqual(['local', 'openai-via-proxy']);
    expect(chain[0]).toMatchObject({
      baseUrl: 'https://a.test/v1',
      protocolKind: 'ollama-embeddings',
      apiKey: null,
      model: 'embeddinggemma:latest',
      dimensions: 768,
    });
    expect(chain[1]).toMatchObject({
      model: 'text-embedding-3-small',
      dimensions: 1536,
    });

    const args = findMany.mock.calls[0]?.[0] as { orderBy?: unknown } | undefined;
    expect(args?.orderBy).toEqual({ priority: 'asc' });
  });

  it('(b) провайдер без активных моделей → пропущен', async () => {
    const { svc } = makeResolver([
      {
        name: 'no-models',
        baseUrl: 'https://a.test/v1',
        protocolKind: 'openai-embeddings',
        apiKeyEncrypted: null,
        models: [],
      },
      {
        name: 'ok',
        baseUrl: 'https://b.test/v1',
        protocolKind: 'openai-embeddings',
        apiKeyEncrypted: null,
        models: [{ modelKey: 'm', dimensions: 768 }],
      },
    ]);

    const chain = await svc.resolveChain();

    expect(chain.map((c) => c.name)).toEqual(['ok']);
  });

  it('(c) apiKeyEncrypted → decrypt вызван, apiKey = расшифрованное', async () => {
    const decrypt = vi.fn((v: string) => `decrypted:${v}`);
    const { svc } = makeResolver(
      [
        {
          name: 'with-key',
          baseUrl: 'https://a.test/v1',
          protocolKind: 'openai-embeddings',
          apiKeyEncrypted: 'gcm:v1:enc',
          models: [{ modelKey: 'm', dimensions: 768 }],
        },
      ],
      decrypt,
    );

    const chain = await svc.resolveChain();

    expect(decrypt).toHaveBeenCalledWith('gcm:v1:enc');
    expect(chain[0]?.apiKey).toBe('decrypted:gcm:v1:enc');
  });

  it('(d) decrypt бросил → провайдер пропущен, цепочка не упала', async () => {
    const decrypt = vi.fn((v: string) => {
      if (v === 'bad') throw new Error('bad key');
      return `decrypted:${v}`;
    });
    const { svc } = makeResolver(
      [
        {
          name: 'broken-key',
          baseUrl: 'https://a.test/v1',
          protocolKind: 'openai-embeddings',
          apiKeyEncrypted: 'bad',
          models: [{ modelKey: 'm', dimensions: 768 }],
        },
        {
          name: 'good-key',
          baseUrl: 'https://b.test/v1',
          protocolKind: 'openai-embeddings',
          apiKeyEncrypted: 'good',
          models: [{ modelKey: 'm2', dimensions: 768 }],
        },
      ],
      decrypt,
    );

    const chain = await svc.resolveChain();

    expect(chain.map((c) => c.name)).toEqual(['good-key']);
    expect(chain[0]?.apiKey).toBe('decrypted:good');
  });
});
