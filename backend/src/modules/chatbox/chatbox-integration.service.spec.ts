import { BadRequestException } from '@nestjs/common';
import type { ChatboxIntegration } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CryptoService } from '../../common/crypto/crypto.service';
import type { PrismaService } from '../../common/prisma/prisma.service';

import { ChatboxApiError } from './chatbox-api.client';
import type { ChatboxApiClient } from './chatbox-api.client';
import { ChatboxIntegrationService } from './chatbox-integration.service';
import type { ChatboxIntegrationUpsertDto } from './dto/chatbox-integration.dto';

function makeRow(over: Partial<ChatboxIntegration> = {}): ChatboxIntegration {
  return {
    id: 'int1',
    tenantId: 't1',
    tokenEnc: 'gcm:v1:secret',
    workspaceId: 'ws1',
    workspaceName: 'WS',
    syncMode: 'daily',
    status: 'connected',
    lastError: null,
    lastFullSyncAt: null,
    lastIncrementalSyncAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...over,
  } as ChatboxIntegration;
}

function errorCode(err: unknown): string | undefined {
  if (!(err instanceof BadRequestException)) return undefined;
  const body = err.getResponse() as { error?: { code?: string } };
  return body.error?.code;
}

describe('ChatboxIntegrationService', () => {
  let prismaMock: {
    chatboxIntegration: {
      findUnique: ReturnType<typeof vi.fn>;
      upsert: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
    };
    source: {
      upsert: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
  };
  let cryptoMock: {
    encrypt: ReturnType<typeof vi.fn>;
    decrypt: ReturnType<typeof vi.fn>;
    isEncrypted: ReturnType<typeof vi.fn>;
  };
  let clientMock: {
    listWorkspaces: ReturnType<typeof vi.fn>;
  };
  let service: ChatboxIntegrationService;

  beforeEach(() => {
    prismaMock = {
      chatboxIntegration: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
        deleteMany: vi.fn(),
      },
      source: {
        upsert: vi.fn().mockResolvedValue({ id: 'src-chatbox' }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    cryptoMock = {
      encrypt: vi.fn((v: string) => `gcm:v1:${v}`),
      decrypt: vi.fn((v: string) => v.replace('gcm:v1:', '')),
      isEncrypted: vi.fn((v: string) => v.startsWith('gcm:v1:')),
    };
    clientMock = {
      listWorkspaces: vi.fn(),
    };

    service = new ChatboxIntegrationService(
      prismaMock as unknown as PrismaService,
      cryptoMock as unknown as CryptoService,
      clientMock as unknown as ChatboxApiClient,
    );
  });

  it('getIntegration: не утекает токен (hasToken=true, нет tokenEnc/token)', async () => {
    prismaMock.chatboxIntegration.findUnique.mockResolvedValue(
      makeRow({ tokenEnc: 'gcm:v1:secret' }),
    );

    const res = await service.getIntegration('t1');

    expect(res).not.toBeNull();
    expect(res?.hasToken).toBe(true);
    expect(Object.keys(res ?? {})).not.toContain('tokenEnc');
    expect(Object.keys(res ?? {})).not.toContain('token');
  });

  it('getIntegration: null если интеграции нет', async () => {
    prismaMock.chatboxIntegration.findUnique.mockResolvedValue(null);

    const res = await service.getIntegration('t1');

    expect(res).toBeNull();
  });

  it('upsert: новый токен + валидный воркспейс → encrypt(token), upsert с workspaceName', async () => {
    prismaMock.chatboxIntegration.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeRow());
    clientMock.listWorkspaces.mockResolvedValue({
      workspaces: [{ id: 'ws1', name: 'WS', role: 'OWNER' }],
      total: 1,
    });
    prismaMock.chatboxIntegration.upsert.mockResolvedValue(makeRow());

    const dto: ChatboxIntegrationUpsertDto = {
      token: 't',
      workspaceId: 'ws1',
      syncMode: 'daily',
    };

    await service.upsert('t1', dto);

    expect(cryptoMock.encrypt).toHaveBeenCalledWith('t');
    expect(prismaMock.chatboxIntegration.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 't1' },
        create: expect.objectContaining({ workspaceName: 'WS' }),
        update: expect.objectContaining({ workspaceName: 'WS' }),
      }),
    );
  });

  it('upsert: workspaceId не найден → chatbox_workspace_not_found', async () => {
    prismaMock.chatboxIntegration.findUnique.mockResolvedValue(null);
    clientMock.listWorkspaces.mockResolvedValue({
      workspaces: [{ id: 'other', name: 'Other', role: 'USER' }],
      total: 1,
    });

    const dto: ChatboxIntegrationUpsertDto = {
      token: 't',
      workspaceId: 'ws1',
      syncMode: 'daily',
    };

    const err = await service.upsert('t1', dto).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(errorCode(err)).toBe('chatbox_workspace_not_found');
    expect(prismaMock.chatboxIntegration.upsert).not.toHaveBeenCalled();
  });

  it('upsert: без токена и без существующей интеграции → chatbox_token_invalid', async () => {
    prismaMock.chatboxIntegration.findUnique.mockResolvedValue(null);

    const dto: ChatboxIntegrationUpsertDto = {
      workspaceId: 'ws1',
      syncMode: 'daily',
    };

    const err = await service.upsert('t1', dto).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(errorCode(err)).toBe('chatbox_token_invalid');
    expect(clientMock.listWorkspaces).not.toHaveBeenCalled();
  });

  it('upsert: update без нового токена → переиспользует существующий tokenEnc', async () => {
    const existing = makeRow({ tokenEnc: 'gcm:v1:oldsecret' });
    prismaMock.chatboxIntegration.findUnique
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(existing);
    clientMock.listWorkspaces.mockResolvedValue({
      workspaces: [{ id: 'ws1', name: 'WS', role: 'OWNER' }],
      total: 1,
    });
    prismaMock.chatboxIntegration.upsert.mockResolvedValue(existing);

    const dto: ChatboxIntegrationUpsertDto = {
      workspaceId: 'ws1',
      syncMode: 'daily',
    };

    await service.upsert('t1', dto);

    expect(cryptoMock.decrypt).toHaveBeenCalledWith('gcm:v1:oldsecret');
    expect(clientMock.listWorkspaces).toHaveBeenCalledWith('oldsecret', expect.anything());
    expect(cryptoMock.encrypt).not.toHaveBeenCalled();
    expect(prismaMock.chatboxIntegration.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ tokenEnc: 'gcm:v1:oldsecret' }),
        update: expect.objectContaining({ tokenEnc: 'gcm:v1:oldsecret' }),
      }),
    );
  });

  it('remove: удаляет интеграцию и деактивирует Source', async () => {
    prismaMock.chatboxIntegration.deleteMany.mockResolvedValue({ count: 1 });

    await service.remove('t1');

    expect(prismaMock.chatboxIntegration.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: 't1' },
    });
    expect(prismaMock.source.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', type: 'chatbox', name: 'ChatBox' },
      data: { isActive: false },
    });
  });

  it('listWorkspaces: 401 от клиента → chatbox_token_invalid', async () => {
    clientMock.listWorkspaces.mockRejectedValue(new ChatboxApiError(401, 'unauthorized', false));

    const err = await service.listWorkspaces('t').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(errorCode(err)).toBe('chatbox_token_invalid');
  });
});
