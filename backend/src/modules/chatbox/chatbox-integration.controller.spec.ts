import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';
import type { EntitlementService } from '../entitlements/entitlement.service';
import type { RbacService } from '../rbac/rbac.service';

import { ChatboxIntegrationController } from './chatbox-integration.controller';
import type { ChatboxIntegrationService } from './chatbox-integration.service';
import type { ChatboxSyncQueueService } from './queue/chatbox-sync.queue.service';

/**
 * Юнит на агрегатный эндпоинт «Чаты в памяти» (ТЗ 2026-06-11 Ф2). Prisma и RBAC
 * полностью замоканы — БД нет. Проверяем контракт полей и что счётчики бьются по
 * правильным where (analysisStatus, sourceType:'chatbox').
 */

const user = { id: 'u1' } as { id: string };

function makeController(
  over: { prisma?: Record<string, unknown>; canRead?: boolean } = {},
): {
  controller: ChatboxIntegrationController;
  prisma: any;
} {
  const prisma = {
    chatboxIntegration: { findUnique: vi.fn() },
    chatboxChat: { count: vi.fn() },
    chatboxChatSession: { count: vi.fn() },
    rawEvent: { count: vi.fn() },
    task: { count: vi.fn() },
    ...over.prisma,
  };
  const rbac = {
    canRead: vi.fn().mockResolvedValue(over.canRead ?? true),
  };
  const controller = new ChatboxIntegrationController(
    {} as unknown as ChatboxIntegrationService,
    rbac as unknown as RbacService,
    {} as unknown as EntitlementService,
    {} as unknown as ChatboxSyncQueueService,
    prisma as unknown as PrismaService,
  );
  return { controller, prisma };
}

describe('ChatboxIntegrationController.memorySummary', () => {
  it('нет интеграции → { configured: false }', async () => {
    const { controller, prisma } = makeController();
    prisma.chatboxIntegration.findUnique.mockResolvedValue(null);

    const out = await controller.memorySummary(user as any, 't1');

    expect(out).toEqual({ configured: false });
  });

  it('есть интеграция → полный контракт + правильные where у count', async () => {
    const { controller, prisma } = makeController();
    prisma.chatboxIntegration.findUnique.mockResolvedValue({
      analysisEnabled: true,
    });
    prisma.chatboxChat.count.mockResolvedValue(12);
    // 5 вызовов chatboxChatSession.count по порядку:
    // sessions / analyzed / inProgress / failed
    prisma.chatboxChatSession.count
      .mockResolvedValueOnce(9) // sessions (всего)
      .mockResolvedValueOnce(5) // analyzed (done)
      .mockResolvedValueOnce(3) // inProgress (pending|analyzing)
      .mockResolvedValueOnce(1); // failed
    prisma.rawEvent.count.mockResolvedValue(7);
    prisma.task.count.mockResolvedValue(4);

    const out = await controller.memorySummary(user as any, 't1');

    expect(out).toEqual({
      configured: true,
      analysisEnabled: true,
      dialogs: 12,
      sessions: 9,
      analyzed: 5,
      inProgress: 3,
      failed: 1,
      blocks: 7,
      tasks: 4,
    });

    // блоки — RawEvent с sourceType:'chatbox'
    expect(prisma.rawEvent.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sourceType: 'chatbox' }),
      }),
    );
    // задачи — Task с sourceType:'chatbox'
    expect(prisma.task.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sourceType: 'chatbox' }),
      }),
    );
    // analyzed — analysisStatus:'done'
    expect(prisma.chatboxChatSession.count).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ analysisStatus: 'done' }),
      }),
    );
    // inProgress — analysisStatus in pending|analyzing
    expect(prisma.chatboxChatSession.count).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: expect.objectContaining({
          analysisStatus: { in: ['pending', 'analyzing'] },
        }),
      }),
    );
  });

  it('нет прав на чтение (canRead=false) → forbidden', async () => {
    const { controller } = makeController({ canRead: false });

    await expect(
      controller.memorySummary(user as any, 't1'),
    ).rejects.toMatchObject({
      response: { error: { code: 'forbidden' } },
    });
  });

  it('нет tenant → tenant_required', async () => {
    const { controller } = makeController();
    await expect(
      controller.memorySummary(user as any, undefined),
    ).rejects.toMatchObject({
      response: { error: { code: 'tenant_required' } },
    });
  });
});
