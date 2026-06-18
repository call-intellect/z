import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { BitrixIntegration } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { CryptoService } from '../../common/crypto/crypto.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { JwtService } from '../auth/services/jwt.service';

import type { BitrixApiClient } from './bitrix-api.client';
import { BitrixIntegrationService } from './bitrix-integration.service';

function makeRow(over: Partial<BitrixIntegration> = {}): BitrixIntegration {
  return {
    id: 'b1',
    memberId: 'M1',
    tenantId: 't1',
    portalDomain: 'acme.bitrix24.ru',
    clientEndpoint: 'https://acme.bitrix24.ru/rest/',
    serverEndpoint: 'https://oauth.bitrix.info/rest/',
    scope: 'crm,user',
    accessTokenEnc: 'gcm:v1:AT',
    refreshTokenEnc: 'gcm:v1:RT',
    applicationTokenEnc: null,
    accessExpiresAt: new Date('2999-01-01T00:00:00.000Z'),
    status: 'connected',
    lastError: null,
    lastConnectedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...over,
  } as BitrixIntegration;
}

function tokenResp(over: Record<string, unknown> = {}) {
  return {
    access_token: 'AT',
    refresh_token: 'RT',
    expires_in: 3600,
    member_id: 'M1',
    client_endpoint: 'https://acme.bitrix24.ru/rest/',
    ...over,
  };
}

describe('BitrixIntegrationService', () => {
  let prismaMock: {
    bitrixIntegration: {
      findFirst: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      upsert: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
    };
    source: { upsert: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
    membership: { findMany: ReturnType<typeof vi.fn> };
  };
  let cryptoMock: {
    encrypt: ReturnType<typeof vi.fn>;
    decrypt: ReturnType<typeof vi.fn>;
  };
  let clientMock: {
    exchangeCode: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    getAppInfo: ReturnType<typeof vi.fn>;
  };
  let jwtMock: {
    signBitrixState: ReturnType<typeof vi.fn>;
    verifyBitrixState: ReturnType<typeof vi.fn>;
  };
  let cfgMock: { bitrix: { clientId: string | undefined } };
  let service: BitrixIntegrationService;

  beforeEach(() => {
    prismaMock = {
      bitrixIntegration: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
        deleteMany: vi.fn(),
      },
      source: {
        upsert: vi.fn().mockResolvedValue({ id: 'src-bitrix' }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      membership: { findMany: vi.fn() },
    };
    cryptoMock = {
      encrypt: vi.fn((v: string) => `gcm:v1:${v}`),
      decrypt: vi.fn((v: string) => v.replace('gcm:v1:', '')),
    };
    clientMock = {
      exchangeCode: vi.fn(),
      refresh: vi.fn(),
      getAppInfo: vi.fn(),
    };
    jwtMock = {
      signBitrixState: vi.fn(() => 'signed.state'),
      verifyBitrixState: vi.fn(),
    };
    cfgMock = { bitrix: { clientId: 'app.test' } };

    service = new BitrixIntegrationService(
      prismaMock as unknown as PrismaService,
      cryptoMock as unknown as CryptoService,
      clientMock as unknown as BitrixApiClient,
      jwtMock as unknown as JwtService,
      cfgMock as unknown as TypedConfigService,
    );
  });

  it('buildAuthorizeUrl: подписывает state и собирает URL портала', () => {
    const url = service.buildAuthorizeUrl('t1', 'acme.bitrix24.ru');
    expect(jwtMock.signBitrixState).toHaveBeenCalledWith({
      sub: 't1',
      domain: 'acme.bitrix24.ru',
    });
    expect(url).toContain('https://acme.bitrix24.ru/oauth/authorize/');
    expect(url).toContain('client_id=app.test');
    expect(url).toContain('state=signed.state');
  });

  it('buildAuthorizeUrl: без client_id → bitrix_misconfigured', () => {
    cfgMock.bitrix.clientId = undefined;
    try {
      service.buildAuthorizeUrl('t1', 'acme.bitrix24.ru');
      throw new Error('должно было бросить');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e as BadRequestException).getResponse()).toMatchObject({
        error: { code: 'bitrix_misconfigured' },
      });
    }
  });

  it('handleOAuthCallback: verify state → exchange → upsert connected', async () => {
    jwtMock.verifyBitrixState.mockReturnValue({
      purpose: 'bitrix_oauth',
      sub: 't1',
      domain: 'acme.bitrix24.ru',
      exp: 9999999999,
    });
    clientMock.exchangeCode.mockResolvedValue(tokenResp());
    prismaMock.bitrixIntegration.findFirst.mockResolvedValue(null);
    prismaMock.bitrixIntegration.upsert.mockResolvedValue(makeRow());

    const res = await service.handleOAuthCallback({
      code: 'c1',
      state: 'signed.state',
    });

    expect(res.portalDomain).toBe('acme.bitrix24.ru');
    expect(clientMock.exchangeCode).toHaveBeenCalledWith('c1');
    const upsertArg = prismaMock.bitrixIntegration.upsert.mock.calls[0]![0];
    expect(upsertArg.where).toEqual({ memberId: 'M1' });
    expect(upsertArg.create.status).toBe('connected');
    expect(upsertArg.create.tenantId).toBe('t1');
    expect(cryptoMock.encrypt).toHaveBeenCalledWith('AT');
    expect(cryptoMock.encrypt).toHaveBeenCalledWith('RT');
  });

  it('handleOAuthCallback: невалидный state → BadRequest', async () => {
    jwtMock.verifyBitrixState.mockImplementation(() => {
      throw new Error('bad');
    });
    await expect(service.handleOAuthCallback({ code: 'c1', state: 'x' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(clientMock.exchangeCode).not.toHaveBeenCalled();
  });

  it('getValidAccessToken: токен жив → не рефрешит', async () => {
    const row = makeRow({ accessExpiresAt: new Date(Date.now() + 600_000) });
    const at = await service.getValidAccessToken(row);
    expect(at).toBe('AT');
    expect(clientMock.refresh).not.toHaveBeenCalled();
  });

  it('getValidAccessToken: протух → refresh + persist', async () => {
    const row = makeRow({ accessExpiresAt: new Date(Date.now() - 1000) });
    clientMock.refresh.mockResolvedValue(tokenResp({ access_token: 'AT2', refresh_token: 'RT2' }));
    prismaMock.bitrixIntegration.upsert.mockResolvedValue(makeRow());

    const at = await service.getValidAccessToken(row);

    expect(at).toBe('AT2');
    expect(clientMock.refresh).toHaveBeenCalledWith('RT');
    expect(cryptoMock.encrypt).toHaveBeenCalledWith('AT2');
  });

  it('getValidAccessToken: провал refresh → status error + throw', async () => {
    const row = makeRow({ accessExpiresAt: new Date(Date.now() - 1000) });
    clientMock.refresh.mockRejectedValue(new Error('boom'));
    prismaMock.bitrixIntegration.update.mockResolvedValue(makeRow());

    await expect(service.getValidAccessToken(row)).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaMock.bitrixIntegration.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'error' }),
      }),
    );
  });

  it('claim: pending по memberId → bind connected', async () => {
    prismaMock.bitrixIntegration.findUnique.mockResolvedValue(
      makeRow({ tenantId: null, status: 'pending' }),
    );
    prismaMock.bitrixIntegration.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeRow());
    prismaMock.bitrixIntegration.update.mockResolvedValue(makeRow());

    await service.claim('t1', 'M1');

    expect(prismaMock.bitrixIntegration.update).toHaveBeenCalledWith({
      where: { memberId: 'M1' },
      data: { tenantId: 't1', status: 'connected', lastError: null },
    });
  });

  it('claim: портал привязан к другой org → Conflict', async () => {
    prismaMock.bitrixIntegration.findUnique.mockResolvedValue(
      makeRow({ tenantId: 'other', status: 'connected' }),
    );
    await expect(service.claim('t1', 'M1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('getIntegration: не утекает токен (hasTokens=true, без *Enc)', async () => {
    prismaMock.bitrixIntegration.findFirst.mockResolvedValue(makeRow());
    const res = await service.getIntegration('t1');
    expect(res?.hasTokens).toBe(true);
    expect(Object.keys(res ?? {})).not.toContain('accessTokenEnc');
    expect(Object.keys(res ?? {})).not.toContain('refreshTokenEnc');
  });

  it('assertNoForeignActiveBinding: другой connected портал у org → Conflict при claim', async () => {
    prismaMock.bitrixIntegration.findUnique.mockResolvedValue(
      makeRow({ tenantId: null, status: 'pending' }),
    );
    prismaMock.bitrixIntegration.findFirst.mockResolvedValueOnce({ id: 'other' });
    await expect(service.claim('t1', 'M1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('bindInstall: один owner/admin-org → авто-привязка (bound)', async () => {
    prismaMock.membership.findMany.mockResolvedValue([
      { orgId: 't1', org: { id: 't1', name: 'Acme' } },
    ]);
    prismaMock.bitrixIntegration.findUnique.mockResolvedValue(
      makeRow({ tenantId: null, status: 'pending' }),
    );
    prismaMock.bitrixIntegration.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeRow());
    prismaMock.bitrixIntegration.update.mockResolvedValue(makeRow());

    const res = await service.bindInstall({ memberId: 'M1', userId: 'u1' });

    expect(res).toEqual({ status: 'bound', portalDomain: 'acme.bitrix24.ru' });
    expect(prismaMock.bitrixIntegration.update).toHaveBeenCalledWith({
      where: { memberId: 'M1' },
      data: { tenantId: 't1', status: 'connected', lastError: null },
    });
  });

  it('bindInstall: несколько org без orgId → select_org, claim не вызывается', async () => {
    prismaMock.membership.findMany.mockResolvedValue([
      { orgId: 't1', org: { id: 't1', name: 'Acme' } },
      { orgId: 't2', org: { id: 't2', name: 'Globex' } },
    ]);

    const res = await service.bindInstall({ memberId: 'M1', userId: 'u1' });

    expect(res).toEqual({
      status: 'select_org',
      orgs: [
        { id: 't1', name: 'Acme' },
        { id: 't2', name: 'Globex' },
      ],
    });
    expect(prismaMock.bitrixIntegration.update).not.toHaveBeenCalled();
  });

  it('bindInstall: нет owner/admin-org → Forbidden', async () => {
    prismaMock.membership.findMany.mockResolvedValue([]);
    await expect(service.bindInstall({ memberId: 'M1', userId: 'u1' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('bindInstall: orgId не из owner/admin-memberships → Forbidden', async () => {
    prismaMock.membership.findMany.mockResolvedValue([
      { orgId: 't1', org: { id: 't1', name: 'Acme' } },
    ]);
    await expect(
      service.bindInstall({ memberId: 'M1', userId: 'u1', orgId: 'foreign' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prismaMock.bitrixIntegration.update).not.toHaveBeenCalled();
  });

  it('claimByDomain: pending по домену найден → claim connected', async () => {
    prismaMock.bitrixIntegration.findFirst
      .mockResolvedValueOnce(makeRow({ tenantId: null, status: 'pending' }))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeRow());
    prismaMock.bitrixIntegration.findUnique.mockResolvedValue(
      makeRow({ tenantId: null, status: 'pending' }),
    );
    prismaMock.bitrixIntegration.update.mockResolvedValue(makeRow());

    const res = await service.claimByDomain('t1', 'acme.bitrix24.ru');

    expect(res.portalDomain).toBe('acme.bitrix24.ru');
    expect(prismaMock.bitrixIntegration.update).toHaveBeenCalledWith({
      where: { memberId: 'M1' },
      data: { tenantId: 't1', status: 'connected', lastError: null },
    });
  });

  it('claimByDomain: pending не найден → NotFound', async () => {
    prismaMock.bitrixIntegration.findFirst.mockResolvedValueOnce(null);
    await expect(service.claimByDomain('t1', 'nope.bitrix24.ru')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
