import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../../common/config/index';
import type { CryptoService } from '../../../../common/crypto/crypto.service';
import type { PrismaService } from '../../../../common/prisma/prisma.service';

import { ProviderInfoResolver } from './provider-info.resolver';

function makeCfg(): TypedConfigService {
  return {
    ai: {
      proxy: {
        baseUrl: 'https://proxy.agent-lia.ru/v1',
        prefix: 'myFeedproxy3128',
      },
      anthropic: { apiKey: 'a', model: 'm', useProxy: false, proxyUrl: '' },
      minimax: { apiKey: 'a', baseUrl: 'https://minimax' },
      openai: { apiKey: 'a' },
      deepseek: { apiKey: 'a', baseUrl: 'https://deepseek', defaultModel: 'm' },
      ollama: { apiKey: '', baseUrl: 'https://ollama' },
      kie: { apiKey: 'a', baseUrl: 'https://kie', timeoutMs: 180_000 },
      grsai: { apiKey: 'a', baseUrl: 'https://grsai' },
    },
  } as unknown as TypedConfigService;
}

function makeCrypto(decryptedValue: string): CryptoService {
  return {
    isEncrypted: vi.fn((v: string) => v.startsWith('gcm:v1:')),
    decrypt: vi.fn(() => decryptedValue),
  } as unknown as CryptoService;
}

describe('ProviderInfoResolver.resolveByName — DB-строка (Ф3 — Резолв эффективного подключения)', () => {
  it('useProxy=true, proxyPath="grsai" → effectiveBaseUrl/apiKey строятся по формуле прокси', async () => {
    const findUnique = vi.fn(async () => ({
      name: 'grsai',
      baseUrl: 'https://grsaiapi.com',
      apiKeyEncrypted: 'gcm:v1:ciphertext',
      protocolKind: 'grsai-native',
      defaultHeaders: null,
      useProxy: true,
      proxyPath: 'grsai',
      timeoutMs: null,
      capability: 'internal',
    }));
    const prisma = { llmProvider: { findUnique } } as unknown as PrismaService;
    const crypto = makeCrypto('plainkey');
    const resolver = new ProviderInfoResolver(prisma, makeCfg(), crypto);

    const result = await resolver.resolveByName('grsai');

    expect(result).not.toBeNull();
    expect(result?.protocolKind).toBe('grsai-native');
    expect(result?.info.baseUrl).toBe('https://proxy.agent-lia.ru/grsai/v1');
    expect(result?.info.apiKey).toBe('myFeedproxy3128:plainkey');
    expect(result?.info.capability).toBe('internal');
  });

  it('useProxy=true, proxyPath=null → effectiveBaseUrl = PROXY_BASE_URL как есть', async () => {
    const findUnique = vi.fn(async () => ({
      name: 'openai-via-proxy',
      baseUrl: 'https://ignored.example',
      apiKeyEncrypted: 'gcm:v1:ciphertext',
      protocolKind: 'openai-responses',
      defaultHeaders: null,
      useProxy: true,
      proxyPath: null,
      timeoutMs: null,
      capability: 'private',
    }));
    const prisma = { llmProvider: { findUnique } } as unknown as PrismaService;
    const crypto = makeCrypto('plainkey');
    const resolver = new ProviderInfoResolver(prisma, makeCfg(), crypto);

    const result = await resolver.resolveByName('openai-via-proxy');

    expect(result?.info.baseUrl).toBe('https://proxy.agent-lia.ru/v1');
    expect(result?.info.apiKey).toBe('myFeedproxy3128:plainkey');
  });

  it('useProxy=false → baseUrl/apiKey ровно из строки, без префикса', async () => {
    const findUnique = vi.fn(async () => ({
      name: 'kie',
      baseUrl: 'https://api.kie.ai',
      apiKeyEncrypted: 'gcm:v1:ciphertext',
      protocolKind: 'kie-native',
      defaultHeaders: null,
      useProxy: false,
      proxyPath: null,
      timeoutMs: 45_000,
      capability: 'private',
    }));
    const prisma = { llmProvider: { findUnique } } as unknown as PrismaService;
    const crypto = makeCrypto('plainkey');
    const resolver = new ProviderInfoResolver(prisma, makeCfg(), crypto);

    const result = await resolver.resolveByName('kie');

    expect(result?.info.baseUrl).toBe('https://api.kie.ai');
    expect(result?.info.apiKey).toBe('plainkey');
    expect(result?.info.timeoutMs).toBe(45_000);
  });

  it('apiKeyEncrypted не зашифрован (plaintext, до патча Ф2) → decrypt не вызывается, значение читается как есть', async () => {
    const findUnique = vi.fn(async () => ({
      name: 'kie',
      baseUrl: 'https://api.kie.ai',
      apiKeyEncrypted: 'plaintext-legacy-key',
      protocolKind: 'kie-native',
      defaultHeaders: null,
      useProxy: false,
      proxyPath: null,
      timeoutMs: null,
      capability: 'private',
    }));
    const prisma = { llmProvider: { findUnique } } as unknown as PrismaService;
    const crypto = makeCrypto('should-not-be-used');
    const resolver = new ProviderInfoResolver(prisma, makeCfg(), crypto);

    const result = await resolver.resolveByName('kie');

    expect(crypto.decrypt).not.toHaveBeenCalled();
    expect(result?.info.apiKey).toBe('plaintext-legacy-key');
  });

  it('60s TTL-кэш: второй вызов в течение TTL не бьёт по Prisma повторно', async () => {
    const findUnique = vi.fn(async () => ({
      name: 'kie',
      baseUrl: 'https://api.kie.ai',
      apiKeyEncrypted: null,
      protocolKind: 'kie-native',
      defaultHeaders: null,
      useProxy: false,
      proxyPath: null,
      timeoutMs: null,
      capability: 'private',
    }));
    const prisma = { llmProvider: { findUnique } } as unknown as PrismaService;
    const resolver = new ProviderInfoResolver(prisma, makeCfg(), makeCrypto('x'));

    await resolver.resolveByName('kie');
    await resolver.resolveByName('kie');

    expect(findUnique).toHaveBeenCalledOnce();
  });
});

describe('ProviderInfoResolver.resolveByName — buildFromEnv (нет DB-строки)', () => {
  it('kie → protocolKind=kie-native, baseUrl/apiKey/timeoutMs из ENV', async () => {
    const findUnique = vi.fn(async () => null);
    const prisma = { llmProvider: { findUnique } } as unknown as PrismaService;
    const resolver = new ProviderInfoResolver(prisma, makeCfg(), makeCrypto('x'));

    const result = await resolver.resolveByName('kie');

    expect(result?.protocolKind).toBe('kie-native');
    expect(result?.info.baseUrl).toBe('https://kie');
    expect(result?.info.apiKey).toBe('a');
    expect(result?.info.timeoutMs).toBe(180_000);
  });

  it('grsai → protocolKind=grsai-native, baseUrl/apiKey из ENV', async () => {
    const findUnique = vi.fn(async () => null);
    const prisma = { llmProvider: { findUnique } } as unknown as PrismaService;
    const resolver = new ProviderInfoResolver(prisma, makeCfg(), makeCrypto('x'));

    const result = await resolver.resolveByName('grsai');

    expect(result?.protocolKind).toBe('grsai-native');
    expect(result?.info.baseUrl).toBe('https://grsai');
    expect(result?.info.apiKey).toBe('a');
  });

  it('неизвестное имя → null', async () => {
    const findUnique = vi.fn(async () => null);
    const prisma = { llmProvider: { findUnique } } as unknown as PrismaService;
    const resolver = new ProviderInfoResolver(prisma, makeCfg(), makeCrypto('x'));

    const result = await resolver.resolveByName('unknown-provider');

    expect(result).toBeNull();
  });
});
