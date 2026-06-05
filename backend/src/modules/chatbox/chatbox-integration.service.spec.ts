import { BadRequestException } from '@nestjs/common';
import type { ChatboxIntegration } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { CryptoService } from '../../common/crypto/crypto.service';
import type { PrismaService } from '../../common/prisma/prisma.service';

import { ChatboxApiError } from './chatbox-api.client';
import type { ChatboxApiClient } from './chatbox-api.client';
import { ChatboxIntegrationService } from './chatbox-integration.service';
import type { ChatboxIntegrationUpsertDto } from './dto/chatbox-integration.dto';

/**
 * Детерминированные unit-тесты ChatboxIntegrationService: Prisma / Crypto /
 * ChatboxApiClient полностью замоканы, БД и сети нет.
 *
 * Контракт ошибок сервиса: BadRequestException с payload
 * `{ ok: false, error: { code, message } }`, достаётся через `.getResponse()`.
 * Коды: `chatbox_token_invalid`, `chatbox_workspace_not_found`.
 */

/** Полная строка ChatboxIntegration (поля, нужные sanitize()). */
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
    webhookExternalId: null,
    webhookSecret: null,
    lastFullSyncAt: null,
    lastIncrementalSyncAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...over,
  } as ChatboxIntegration;
}

/** Достаёт error.code из брошенного BadRequestException. */
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
  };
  let cryptoMock: {
    encrypt: ReturnType<typeof vi.fn>;
    decrypt: ReturnType<typeof vi.fn>;
    isEncrypted: ReturnType<typeof vi.fn>;
  };
  let clientMock: {
    listWorkspaces: ReturnType<typeof vi.fn>;
    createWebhook: ReturnType<typeof vi.fn>;
    deleteWebhook: ReturnType<typeof vi.fn>;
  };
  let cfgMock: { publicHostUrl: string };
  let service: ChatboxIntegrationService;

  beforeEach(() => {
    prismaMock = {
      chatboxIntegration: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
        deleteMany: vi.fn(),
      },
    };
    cryptoMock = {
      encrypt: vi.fn((v: string) => `gcm:v1:${v}`),
      decrypt: vi.fn((v: string) => v.replace('gcm:v1:', '')),
      isEncrypted: vi.fn((v: string) => v.startsWith('gcm:v1:')),
    };
    clientMock = {
      listWorkspaces: vi.fn(),
      createWebhook: vi.fn(),
      deleteWebhook: vi.fn(),
    };
    cfgMock = { publicHostUrl: 'https://z.example.com' };

    service = new ChatboxIntegrationService(
      prismaMock as unknown as PrismaService,
      cryptoMock as unknown as CryptoService,
      clientMock as unknown as ChatboxApiClient,
      cfgMock as unknown as TypedConfigService,
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
      .mockResolvedValueOnce(null) // existing внутри upsert()
      .mockResolvedValueOnce(makeRow()); // повторный read в конце upsert()
    clientMock.listWorkspaces.mockResolvedValue({
      workspaces: [{ id: 'ws1', name: 'WS', role: 'USER' }],
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
      .mockResolvedValueOnce(existing) // existing внутри upsert()
      .mockResolvedValueOnce(existing); // повторный read в конце
    clientMock.listWorkspaces.mockResolvedValue({
      workspaces: [{ id: 'ws1', name: 'WS', role: 'USER' }],
      total: 1,
    });
    prismaMock.chatboxIntegration.upsert.mockResolvedValue(existing);

    const dto: ChatboxIntegrationUpsertDto = {
      workspaceId: 'ws1',
      syncMode: 'daily',
    };

    await service.upsert('t1', dto);

    // расшифровали старый tokenEnc...
    expect(cryptoMock.decrypt).toHaveBeenCalledWith('gcm:v1:oldsecret');
    // ...и вызвали API расшифрованным токеном
    expect(clientMock.listWorkspaces).toHaveBeenCalledWith(
      'oldsecret',
      expect.anything(),
    );
    // не шифровали заново (нового токена нет)
    expect(cryptoMock.encrypt).not.toHaveBeenCalled();
    // в upsert ушёл старый tokenEnc
    expect(prismaMock.chatboxIntegration.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ tokenEnc: 'gcm:v1:oldsecret' }),
        update: expect.objectContaining({ tokenEnc: 'gcm:v1:oldsecret' }),
      }),
    );
  });

  it('upsert: syncMode=realtime без webhook → createWebhook + сохранение полей', async () => {
    const savedRow = makeRow({ syncMode: 'realtime' });
    prismaMock.chatboxIntegration.findUnique
      .mockResolvedValueOnce(null) // existing внутри upsert()
      .mockResolvedValueOnce(makeRow({ syncMode: 'realtime' })); // финальный read
    clientMock.listWorkspaces.mockResolvedValue({
      workspaces: [{ id: 'ws1', name: 'WS', role: 'USER' }],
      total: 1,
    });
    prismaMock.chatboxIntegration.upsert.mockResolvedValue(savedRow);
    prismaMock.chatboxIntegration.update.mockResolvedValue(savedRow);
    clientMock.createWebhook.mockResolvedValue({ id: 'wh1' });

    const dto: ChatboxIntegrationUpsertDto = {
      token: 't',
      workspaceId: 'ws1',
      syncMode: 'realtime',
    };

    await service.upsert('t1', dto);

    expect(clientMock.createWebhook).toHaveBeenCalledWith(
      't',
      'ws1',
      expect.objectContaining({
        url: expect.stringContaining(
          'https://z.example.com/api/v1/webhooks/chatbox/t1/',
        ),
        events: expect.arrayContaining(['MESSAGE_CREATED', 'CHAT_CREATED']),
      }),
    );
    expect(prismaMock.chatboxIntegration.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 't1' },
        data: expect.objectContaining({ webhookExternalId: 'wh1' }),
      }),
    );
  });

  it('upsert: createWebhook падает → upsert не роняется, status=error', async () => {
    const savedRow = makeRow({ syncMode: 'realtime' });
    prismaMock.chatboxIntegration.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeRow({ syncMode: 'realtime' }));
    clientMock.listWorkspaces.mockResolvedValue({
      workspaces: [{ id: 'ws1', name: 'WS', role: 'USER' }],
      total: 1,
    });
    prismaMock.chatboxIntegration.upsert.mockResolvedValue(savedRow);
    prismaMock.chatboxIntegration.update.mockResolvedValue(savedRow);
    clientMock.createWebhook.mockRejectedValue(new Error('boom'));

    const dto: ChatboxIntegrationUpsertDto = {
      token: 't',
      workspaceId: 'ws1',
      syncMode: 'realtime',
    };

    // upsert не должен бросить — best-effort
    await expect(service.upsert('t1', dto)).resolves.toBeDefined();
    expect(prismaMock.chatboxIntegration.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'error',
          lastError: 'boom',
        }),
      }),
    );
  });

  it('upsert: syncMode!=realtime со старым webhook → deleteWebhook + очистка', async () => {
    const savedRow = makeRow({
      syncMode: 'daily',
      webhookExternalId: 'wh1',
      webhookSecret: 's3cr3t',
    });
    prismaMock.chatboxIntegration.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeRow());
    clientMock.listWorkspaces.mockResolvedValue({
      workspaces: [{ id: 'ws1', name: 'WS', role: 'USER' }],
      total: 1,
    });
    prismaMock.chatboxIntegration.upsert.mockResolvedValue(savedRow);
    prismaMock.chatboxIntegration.update.mockResolvedValue(savedRow);
    clientMock.deleteWebhook.mockResolvedValue(undefined);

    const dto: ChatboxIntegrationUpsertDto = {
      token: 't',
      workspaceId: 'ws1',
      syncMode: 'daily',
    };

    await service.upsert('t1', dto);

    expect(clientMock.deleteWebhook).toHaveBeenCalledWith('t', 'ws1', 'wh1');
    expect(prismaMock.chatboxIntegration.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          webhookExternalId: null,
          webhookSecret: null,
        }),
      }),
    );
  });

  it('remove: со старым webhook → deleteWebhook перед удалением строки', async () => {
    prismaMock.chatboxIntegration.findUnique.mockResolvedValue(
      makeRow({ webhookExternalId: 'wh1', tokenEnc: 'gcm:v1:tok' }),
    );
    clientMock.deleteWebhook.mockResolvedValue(undefined);
    prismaMock.chatboxIntegration.deleteMany.mockResolvedValue({ count: 1 });

    await service.remove('t1');

    expect(clientMock.deleteWebhook).toHaveBeenCalledWith('tok', 'ws1', 'wh1');
    expect(prismaMock.chatboxIntegration.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: 't1' },
    });
  });

  it('listWorkspaces: 401 от клиента → chatbox_token_invalid', async () => {
    clientMock.listWorkspaces.mockRejectedValue(
      new ChatboxApiError(401, 'unauthorized', false),
    );

    const err = await service.listWorkspaces('t').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(errorCode(err)).toBe('chatbox_token_invalid');
  });
});
