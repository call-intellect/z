import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AdminSettingsService } from '../admin/settings/admin-settings.service';

import { ChatboxAnalyzeCron } from './chatbox-analyze.cron';
import type { ChatboxAnalyzeQueueService } from './queue/chatbox-analyze.queue.service';

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
  let metricsMock: {
    setChatboxPendingSessions: ReturnType<typeof vi.fn>;
    setChatboxStuckAnalyzing: ReturnType<typeof vi.fn>;
  };
  let cron: ChatboxAnalyzeCron;

  beforeEach(() => {
    prismaMock = {
      chatboxChatSession: {
        findMany: vi.fn(),
        count: vi.fn().mockImplementation((args: { where?: { analysisStatus?: string } }) =>
          Promise.resolve(args?.where?.analysisStatus === 'analyzing' ? 1 : 5),
        ),
      },
      chatboxIntegration: {
        findMany: vi.fn().mockResolvedValue([{ tenantId: 't1' }, { tenantId: 't2' }]),
      },
    };
    queueMock = { enqueue: vi.fn().mockResolvedValue({ jobId: 'j1' }) };
    adminMock = {
      get: vi.fn().mockImplementation((key: string, def?: unknown) =>
        Promise.resolve(key === 'chatbox.enabled' ? true : def),
      ),
    };
    metricsMock = {
      setChatboxPendingSessions: vi.fn(),
      setChatboxStuckAnalyzing: vi.fn(),
    };

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
          OR: [
            { analysisStatus: 'pending', endedAt: { not: null } },
            { analysisStatus: 'analyzing', updatedAt: expect.objectContaining({ lt: expect.any(Date) }) },
          ],
        }),
      }),
    );
    expect(queueMock.enqueue).toHaveBeenCalledTimes(2);
    expect(queueMock.enqueue).toHaveBeenCalledWith('t1', 's1');
    expect(queueMock.enqueue).toHaveBeenCalledWith('t2', 's2');
    expect(metricsMock.setChatboxPendingSessions).toHaveBeenCalledWith(5);
    expect(prismaMock.chatboxChatSession.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ analysisStatus: 'pending' }),
      }),
    );
  });

  it('подбирает pending+ended И застрявшую analyzing, ставит gauge stuck', async () => {
    prismaMock.chatboxChatSession.findMany.mockResolvedValue([
      { id: 's1', tenantId: 't1' },
      { id: 's2', tenantId: 't2' },
    ]);

    await cron.sweep();

    const whereArg = prismaMock.chatboxChatSession.findMany.mock.calls[0]![0] as {
      where: { OR: Array<{ analysisStatus: string; updatedAt?: { lt: Date } }> };
    };
    expect(whereArg.where.OR).toEqual([
      { analysisStatus: 'pending', endedAt: { not: null } },
      { analysisStatus: 'analyzing', updatedAt: { lt: expect.any(Date) } },
    ]);
    expect(queueMock.enqueue).toHaveBeenCalledTimes(2);
    expect(queueMock.enqueue).toHaveBeenCalledWith('t1', 's1');
    expect(queueMock.enqueue).toHaveBeenCalledWith('t2', 's2');
    expect(metricsMock.setChatboxStuckAnalyzing).toHaveBeenCalledWith(1);
    expect(prismaMock.chatboxChatSession.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ analysisStatus: 'analyzing' }),
      }),
    );
  });

  it('свежая analyzing-сессия (updatedAt недавний) не подбирается порогом', async () => {
    const stuckMin = 15;
    const now = Date.now();
    const freshUpdatedAt = new Date(now - 60_000);
    const stuckUpdatedAt = new Date(now - (stuckMin + 5) * 60_000);

    prismaMock.chatboxChatSession.findMany.mockImplementation(
      (args: { where: { OR: Array<{ analysisStatus: string; updatedAt?: { lt: Date } }> } }) => {
        const stuckClause = args.where.OR.find((c) => c.analysisStatus === 'analyzing');
        const threshold = stuckClause?.updatedAt?.lt ?? new Date(0);
        const rows: Array<{ id: string; tenantId: string }> = [];
        if (stuckUpdatedAt < threshold) rows.push({ id: 'stuck', tenantId: 't1' });
        if (freshUpdatedAt < threshold) rows.push({ id: 'fresh', tenantId: 't1' });
        return Promise.resolve(rows);
      },
    );

    await cron.sweep();

    expect(queueMock.enqueue).toHaveBeenCalledTimes(1);
    expect(queueMock.enqueue).toHaveBeenCalledWith('t1', 'stuck');
    expect(queueMock.enqueue).not.toHaveBeenCalledWith('t1', 'fresh');
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
