import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AdminSettingsService } from '../admin/settings/admin-settings.service';

import { ChatboxAnalyzeCron } from './chatbox-analyze.cron';
import type { ChatboxAnalyzeQueueService } from './queue/chatbox-analyze.queue.service';

/**
 * Unit-тесты sweeper'а анализа сессий ChatBox: Prisma / Queue / AdminSettings
 * замоканы. Проверяем kill-switch и постановку analyze-job по pending-сессиям.
 */
describe('ChatboxAnalyzeCron', () => {
  let prismaMock: {
    chatboxChatSession: {
      findMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
    };
    chatboxIntegration: { findMany: ReturnType<typeof vi.fn> };
  };
  let queueMock: { enqueue: ReturnType<typeof vi.fn> };
  let adminMock: { get: ReturnType<typeof vi.fn> };
  let metricsMock: { setChatboxPendingSessions: ReturnType<typeof vi.fn> };
  let cron: ChatboxAnalyzeCron;

  beforeEach(() => {
    prismaMock = {
      chatboxChatSession: {
        findMany: vi.fn(),
        // Системный总 pending для gauge (Ф3).
        count: vi.fn().mockResolvedValue(5),
      },
      // Гейт анализа: по умолчанию оба тенанта с analysisEnabled=true.
      chatboxIntegration: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ tenantId: 't1' }, { tenantId: 't2' }]),
      },
    };
    queueMock = { enqueue: vi.fn().mockResolvedValue({ jobId: 'j1' }) };
    adminMock = { get: vi.fn().mockResolvedValue(true) };
    metricsMock = { setChatboxPendingSessions: vi.fn() };

    cron = new ChatboxAnalyzeCron(
      prismaMock as unknown as PrismaService,
      queueMock as unknown as ChatboxAnalyzeQueueService,
      adminMock as unknown as AdminSettingsService,
      metricsMock as unknown as BusinessMetricsService,
    );
  });

  it('kill-switch off → enqueue не вызывался', async () => {
    adminMock.get.mockResolvedValue(false);

    await cron.sweep();

    expect(prismaMock.chatboxChatSession.findMany).not.toHaveBeenCalled();
    expect(queueMock.enqueue).not.toHaveBeenCalled();
  });

  it('нет оргов с analysisEnabled=true → сессии не трогаем, enqueue не вызывался', async () => {
    prismaMock.chatboxIntegration.findMany.mockResolvedValue([]);

    await cron.sweep();

    expect(prismaMock.chatboxChatSession.findMany).not.toHaveBeenCalled();
    expect(queueMock.enqueue).not.toHaveBeenCalled();
  });

  it('2 pending closed сессии → enqueue x2', async () => {
    prismaMock.chatboxChatSession.findMany.mockResolvedValue([
      { id: 's1', tenantId: 't1' },
      { id: 's2', tenantId: 't2' },
    ]);

    await cron.sweep();

    expect(prismaMock.chatboxChatSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          analysisStatus: 'pending',
          endedAt: { not: null },
        }),
      }),
    );
    expect(queueMock.enqueue).toHaveBeenCalledTimes(2);
    expect(queueMock.enqueue).toHaveBeenCalledWith('t1', 's1');
    expect(queueMock.enqueue).toHaveBeenCalledWith('t2', 's2');
    // Ф3 — gauge pending-сессий выставлен системным总 (count=5).
    expect(metricsMock.setChatboxPendingSessions).toHaveBeenCalledWith(5);
    expect(prismaMock.chatboxChatSession.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ analysisStatus: 'pending' }),
      }),
    );
  });

  it('enqueue по одной сессии упал → проход не падает', async () => {
    prismaMock.chatboxChatSession.findMany.mockResolvedValue([
      { id: 's1', tenantId: 't1' },
      { id: 's2', tenantId: 't2' },
    ]);
    queueMock.enqueue
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ jobId: 'j2' });

    await expect(cron.sweep()).resolves.toBeUndefined();
    expect(queueMock.enqueue).toHaveBeenCalledTimes(2);
  });
});
