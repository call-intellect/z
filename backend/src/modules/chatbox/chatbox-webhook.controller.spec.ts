import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AdminSettingsService } from '../admin/settings/admin-settings.service';

import { ChatboxWebhookController } from './chatbox-webhook.controller';
import type { ChatboxSyncQueueService } from './queue/chatbox-sync.queue.service';

/**
 * Unit-тесты inbound webhook ChatBox: Prisma / Queue / AdminSettings замоканы.
 * Контракт: всегда 200 (`{ok:true}`) кроме явного ForbiddenException
 * (нет интеграции / нет secret'а / несовпадение secret'а).
 */
describe('ChatboxWebhookController', () => {
  const SECRET = 'a'.repeat(48);

  let prismaMock: {
    chatboxIntegration: { findUnique: ReturnType<typeof vi.fn> };
  };
  let queueMock: { enqueue: ReturnType<typeof vi.fn> };
  let adminMock: { get: ReturnType<typeof vi.fn> };
  let controller: ChatboxWebhookController;

  beforeEach(() => {
    prismaMock = {
      chatboxIntegration: { findUnique: vi.fn() },
    };
    queueMock = { enqueue: vi.fn().mockResolvedValue({ jobId: 'j1' }) };
    adminMock = { get: vi.fn().mockResolvedValue(true) };

    controller = new ChatboxWebhookController(
      prismaMock as unknown as PrismaService,
      queueMock as unknown as ChatboxSyncQueueService,
      adminMock as unknown as AdminSettingsService,
    );
  });

  it('нет интеграции → ForbiddenException, enqueue не вызван', async () => {
    prismaMock.chatboxIntegration.findUnique.mockResolvedValue(null);

    await expect(
      controller.receive('t1', SECRET, { event: 'MESSAGE_CREATED' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(queueMock.enqueue).not.toHaveBeenCalled();
  });

  it('пустой webhookSecret → ForbiddenException', async () => {
    prismaMock.chatboxIntegration.findUnique.mockResolvedValue({
      webhookSecret: null,
    });

    await expect(
      controller.receive('t1', SECRET, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(queueMock.enqueue).not.toHaveBeenCalled();
  });

  it('неверный secret → ForbiddenException, enqueue не вызван', async () => {
    prismaMock.chatboxIntegration.findUnique.mockResolvedValue({
      webhookSecret: SECRET,
    });

    await expect(
      controller.receive('t1', 'b'.repeat(48), {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(queueMock.enqueue).not.toHaveBeenCalled();
  });

  it('верный secret + kill-switch on → enqueue(incremental), {ok:true}', async () => {
    prismaMock.chatboxIntegration.findUnique.mockResolvedValue({
      webhookSecret: SECRET,
    });
    adminMock.get.mockResolvedValue(true);

    const res = await controller.receive('t1', SECRET, {
      event: 'MESSAGE_CREATED',
    });

    expect(res).toEqual({ ok: true });
    expect(queueMock.enqueue).toHaveBeenCalledWith('t1', 'incremental');
  });

  it('kill-switch off → {ok:true}, enqueue не вызван', async () => {
    prismaMock.chatboxIntegration.findUnique.mockResolvedValue({
      webhookSecret: SECRET,
    });
    adminMock.get.mockResolvedValue(false);

    const res = await controller.receive('t1', SECRET, {});

    expect(res).toEqual({ ok: true });
    expect(queueMock.enqueue).not.toHaveBeenCalled();
  });

  it('внутренняя ошибка enqueue → 200 (не пробрасывается)', async () => {
    prismaMock.chatboxIntegration.findUnique.mockResolvedValue({
      webhookSecret: SECRET,
    });
    queueMock.enqueue.mockRejectedValue(new Error('redis down'));

    const res = await controller.receive('t1', SECRET, {});

    expect(res).toEqual({ ok: true });
  });
});
