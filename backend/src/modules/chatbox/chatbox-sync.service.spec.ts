import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AdminSettingsService } from '../admin/settings/admin-settings.service';

import type { ChatboxApiClient } from './chatbox-api.client';
import type { ChatboxIntegrationService } from './chatbox-integration.service';
import type { ChatboxSessionService } from './chatbox-session.service';
import { ChatboxSyncService } from './chatbox-sync.service';

/**
 * Unit-тесты ChatboxSyncService с замоканными client / prisma / integration /
 * session / adminSettings. БД и сети нет. Проверяем kill-switch (no-op без
 * вызова клиента) и контракт upsert для members (linkedPersonId не в data).
 */

const CFG = { workspaceId: 'ws1', token: 'tok', integrationId: 'int1' };

describe('ChatboxSyncService', () => {
  let clientMock: {
    listChannels: ReturnType<typeof vi.fn>;
    listCustomers: ReturnType<typeof vi.fn>;
    listChannelClients: ReturnType<typeof vi.fn>;
    listMembers: ReturnType<typeof vi.fn>;
    listChats: ReturnType<typeof vi.fn>;
    listMessages: ReturnType<typeof vi.fn>;
  };
  let prismaMock: {
    chatboxMember: { upsert: ReturnType<typeof vi.fn> };
    chatboxChannel: { findMany: ReturnType<typeof vi.fn> };
  };
  let integrationMock: { getConfigForSync: ReturnType<typeof vi.fn> };
  let sessionMock: { rebuildSessions: ReturnType<typeof vi.fn> };
  let adminMock: { get: ReturnType<typeof vi.fn> };
  let service: ChatboxSyncService;

  beforeEach(() => {
    clientMock = {
      listChannels: vi.fn(),
      listCustomers: vi.fn(),
      listChannelClients: vi.fn(),
      listMembers: vi.fn(),
      listChats: vi.fn(),
      listMessages: vi.fn(),
    };
    prismaMock = {
      chatboxMember: { upsert: vi.fn().mockResolvedValue({ id: 'mem1' }) },
      chatboxChannel: { findMany: vi.fn().mockResolvedValue([]) },
    };
    integrationMock = {
      getConfigForSync: vi.fn().mockResolvedValue(CFG),
    };
    sessionMock = { rebuildSessions: vi.fn().mockResolvedValue({ sessionCount: 0 }) };
    adminMock = { get: vi.fn().mockResolvedValue(true) };

    service = new ChatboxSyncService(
      prismaMock as unknown as PrismaService,
      clientMock as unknown as ChatboxApiClient,
      integrationMock as unknown as ChatboxIntegrationService,
      sessionMock as unknown as ChatboxSessionService,
      adminMock as unknown as AdminSettingsService,
    );
  });

  it('kill-switch false → syncChats возвращает рано, client не вызван', async () => {
    adminMock.get.mockResolvedValue(false);
    const count = await service.syncChats('t1');
    expect(count).toBe(0);
    expect(clientMock.listChats).not.toHaveBeenCalled();
    expect(integrationMock.getConfigForSync).not.toHaveBeenCalled();
  });

  it('syncMembers: upsert по числу members, linkedPersonId не в data', async () => {
    clientMock.listMembers.mockResolvedValue({
      members: [
        { id: 'a', email: 'a@x.ru', name: 'A', role: 'MANAGER', createdAt: '2026-01-01' },
        { id: 'b', email: 'b@x.ru', name: 'B', role: 'USER', createdAt: '2026-01-01' },
      ],
      total: 2,
    });

    const count = await service.syncMembers('t1');
    expect(count).toBe(2);
    expect(prismaMock.chatboxMember.upsert).toHaveBeenCalledTimes(2);

    const firstCall = prismaMock.chatboxMember.upsert.mock.calls[0]![0] as {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(firstCall.create).toEqual(
      expect.objectContaining({
        tenantId: 't1',
        externalId: 'a',
        email: 'a@x.ru',
        name: 'A',
        role: 'MANAGER',
      }),
    );
    // Фаза 9: linkedPersonId / linkMode НЕ синкаем.
    expect(firstCall.create).not.toHaveProperty('linkedPersonId');
    expect(firstCall.create).not.toHaveProperty('linkMode');
    expect(firstCall.update).not.toHaveProperty('linkedPersonId');
  });
});
