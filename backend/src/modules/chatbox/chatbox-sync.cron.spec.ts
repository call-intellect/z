import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AdminSettingsService } from '../admin/settings/admin-settings.service';

import { ChatboxSyncCron } from './chatbox-sync.cron';
import type { ChatboxSyncQueueService } from './queue/chatbox-sync.queue.service';

/**
 * Unit-тесты планировщика синка ChatBox: Prisma / Queue / AdminSettings
 * замоканы. Проверяем kill-switch и постановку incremental-job по интеграциям.
 */
describe('ChatboxSyncCron', () => {
  let prismaMock: {
    chatboxIntegration: { findMany: ReturnType<typeof vi.fn> };
  };
  let queueMock: { enqueue: ReturnType<typeof vi.fn> };
  let adminMock: { get: ReturnType<typeof vi.fn> };
  let cron: ChatboxSyncCron;

  beforeEach(() => {
    prismaMock = {
      chatboxIntegration: { findMany: vi.fn() },
    };
    queueMock = { enqueue: vi.fn().mockResolvedValue({ jobId: 'j1' }) };
    adminMock = { get: vi.fn().mockResolvedValue(true) };

    cron = new ChatboxSyncCron(
      prismaMock as unknown as PrismaService,
      queueMock as unknown as ChatboxSyncQueueService,
      adminMock as unknown as AdminSettingsService,
    );
  });

  it('runHourly: kill-switch off → enqueue не вызывался', async () => {
    adminMock.get.mockResolvedValue(false);

    await cron.runHourly();

    expect(prismaMock.chatboxIntegration.findMany).not.toHaveBeenCalled();
    expect(queueMock.enqueue).not.toHaveBeenCalled();
  });

  it('runHourly: 2 интеграции (hourly+realtime) → enqueue x2 c incremental', async () => {
    prismaMock.chatboxIntegration.findMany.mockResolvedValue([
      { tenantId: 't1' },
      { tenantId: 't2' },
    ]);

    await cron.runHourly();

    expect(prismaMock.chatboxIntegration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          syncMode: { in: ['hourly', 'realtime'] },
          status: { not: 'disconnected' },
        }),
      }),
    );
    expect(queueMock.enqueue).toHaveBeenCalledTimes(2);
    expect(queueMock.enqueue).toHaveBeenCalledWith('t1', 'incremental');
    expect(queueMock.enqueue).toHaveBeenCalledWith('t2', 'incremental');
  });

  it('runDaily: фильтрует syncMode=daily', async () => {
    prismaMock.chatboxIntegration.findMany.mockResolvedValue([
      { tenantId: 't1' },
    ]);

    await cron.runDaily();

    expect(prismaMock.chatboxIntegration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          syncMode: { in: ['daily'] },
        }),
      }),
    );
    expect(queueMock.enqueue).toHaveBeenCalledWith('t1', 'incremental');
  });

  it('enqueue по одной интеграции упал → проход не падает', async () => {
    prismaMock.chatboxIntegration.findMany.mockResolvedValue([
      { tenantId: 't1' },
      { tenantId: 't2' },
    ]);
    queueMock.enqueue
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ jobId: 'j2' });

    await expect(cron.runHourly()).resolves.toBeUndefined();
    expect(queueMock.enqueue).toHaveBeenCalledTimes(2);
  });
});
