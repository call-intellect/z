import { randomBytes } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../../common/config/index';
import { CryptoService } from '../../../../common/crypto/crypto.service';
import type { PrismaService } from '../../../../common/prisma/prisma.service';

import { TochkaOAuthService } from './tochka-oauth.service';

/**
 * audit Б5 (2026-05-29) — спецификация storeTokens / getStoredTokens
 * на шифрование/расшифровку OAuth-токенов Точки.
 *
 * Покрытие:
 *   - storeTokens пишет `{ enc: 'gcm:v1:...' }` (а не plain),
 *   - getStoredTokens расшифровывает обратно,
 *   - getStoredTokens с legacy plain-форматом возвращает оригинал (fallback).
 */

function makeCryptoCfg(): TypedConfigService {
  const key32 = randomBytes(32).toString('base64');
  return {
    crypto: { masterKey: key32 },
    billing: { tochka: { isSandbox: false, clientId: 'cid', clientSecret: 'cs' } },
  } as unknown as TypedConfigService;
}

describe('TochkaOAuthService storeTokens / getStoredTokens (audit Б5)', () => {
  let cfg: TypedConfigService;
  let crypto: CryptoService;
  let prisma: {
    billingProviderConfig: {
      findUnique: ReturnType<typeof vi.fn>;
      upsert: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    cfg = makeCryptoCfg();
    crypto = new CryptoService(cfg);
    prisma = {
      billingProviderConfig: {
        findUnique: vi.fn(),
        upsert: vi.fn(async () => ({})),
      },
    };
  });

  function makeSvc(): TochkaOAuthService {
    return new TochkaOAuthService(prisma as unknown as PrismaService, cfg, crypto);
  }

  it('storeTokens записывает зашифрованный конверт { enc: gcm:v1:... }', async () => {
    const svc = makeSvc();
    // Дёргаем приватный метод через as-any (тест на инфраструктуру).
    const stored = await (svc as unknown as {
      storeTokens: (r: unknown, fallback?: string) => Promise<unknown>;
    }).storeTokens({
      access_token: 'AT-secret',
      refresh_token: 'RT-secret',
      expires_in: 3600,
      token_type: 'bearer',
    });
    expect(stored).toMatchObject({ accessToken: 'AT-secret', refreshToken: 'RT-secret' });

    expect(prisma.billingProviderConfig.upsert).toHaveBeenCalled();
    const call = prisma.billingProviderConfig.upsert.mock.calls[0]?.[0] as {
      create: { valueJson: { enc?: string } };
    };
    expect(call.create.valueJson.enc).toMatch(/^gcm:v1:/);
    // Plain-секреты не должны попасть в БД.
    expect(JSON.stringify(call.create.valueJson)).not.toContain('AT-secret');
    expect(JSON.stringify(call.create.valueJson)).not.toContain('RT-secret');
  });

  it('getStoredTokens расшифровывает конверт обратно', async () => {
    const original = {
      accessToken: 'AT-roundtrip',
      refreshToken: 'RT-roundtrip',
      tokenType: 'bearer',
      obtainedAt: new Date().toISOString(),
    };
    const enc = crypto.encrypt(JSON.stringify(original));
    prisma.billingProviderConfig.findUnique.mockResolvedValueOnce({
      key: 'tochka.production.oauth_tokens',
      valueJson: { enc },
    });
    const svc = makeSvc();
    const tokens = await (svc as unknown as {
      getStoredTokens: () => Promise<unknown>;
    }).getStoredTokens();
    expect(tokens).toMatchObject(original);
  });

  it('getStoredTokens с legacy plain-форматом возвращает оригинал (fallback)', async () => {
    prisma.billingProviderConfig.findUnique.mockResolvedValueOnce({
      key: 'tochka.production.oauth_tokens',
      valueJson: { accessToken: 'AT-legacy', refreshToken: 'RT-legacy' },
    });
    const svc = makeSvc();
    const tokens = await (svc as unknown as {
      getStoredTokens: () => Promise<unknown>;
    }).getStoredTokens();
    expect(tokens).toMatchObject({ accessToken: 'AT-legacy', refreshToken: 'RT-legacy' });
  });
});
