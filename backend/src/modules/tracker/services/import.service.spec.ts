import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';

import { ImportService } from './import.service';

/**
 * Unit-тесты `ImportService`. Мокируем PrismaService + BullMQ Queue (через
 * приватное поле `queue` — задаём вручную после конструктора, не зовём
 * onModuleInit).
 */

function makeService(): {
  svc: ImportService;
  prisma: {
    importLog: {
      create: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };
  metrics: { incImportStarted: ReturnType<typeof vi.fn> };
  queueAdd: ReturnType<typeof vi.fn>;
} {
  const prisma = {
    importLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'imp-1',
        ...data,
      })),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'imp-1',
        tenantId: 't1',
        source: 'trello',
        startedAt: new Date(),
        completedAt: null,
        totalProjects: 0,
        totalIssues: 0,
        totalComments: 0,
        totalAttachments: 0,
        processedItems: 0,
        errors: null,
        status: 'cancelled',
        paramsJson: null,
        unmatchedJson: null,
        initiatedByUserId: 'u1',
        ...data,
      })),
    },
  };
  const redis = { client: {} } as unknown as RedisService;
  const metrics = {
    incImportStarted: vi.fn(),
  } as unknown as BusinessMetricsService & {
    incImportStarted: ReturnType<typeof vi.fn>;
  };
  const svc = new ImportService(
    prisma as unknown as PrismaService,
    redis,
    metrics,
  );

  const queueAdd = vi.fn(async () => undefined);
  // Подменим приватное поле queue, чтобы избежать создания реальной BullMQ-очереди.
  (svc as unknown as { queue: { add: typeof queueAdd } }).queue = {
    add: queueAdd,
  };
  return {
    svc,
    prisma,
    metrics: metrics as unknown as { incImportStarted: typeof queueAdd },
    queueAdd,
  };
}

describe('ImportService.start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('создаёт ImportLog в статусе running и enqueue job', async () => {
    const { svc, prisma, queueAdd, metrics } = makeService();
    const out = await svc.start({
      tenantId: 't1',
      userId: 'u1',
      source: 'trello',
      paramsJson: { foo: 'bar' },
    });
    expect(out.importLogId).toBe('imp-1');
    expect(prisma.importLog.create).toHaveBeenCalledTimes(1);
    const createArg = prisma.importLog.create.mock.calls[0]?.[0]?.data;
    expect(createArg?.status).toBe('running');
    expect(createArg?.source).toBe('trello');
    expect(createArg?.tenantId).toBe('t1');
    expect(createArg?.initiatedByUserId).toBe('u1');

    expect(queueAdd).toHaveBeenCalledTimes(1);
    const [name, data, opts] = queueAdd.mock.calls[0]!;
    expect(name).toBe('import-tracker');
    expect(data).toEqual({ tenantId: 't1', importLogId: 'imp-1' });
    expect(opts).toMatchObject({ jobId: 'import-tracker_imp-1' });

    expect(metrics.incImportStarted).toHaveBeenCalledTimes(1);
  });

  it('при падении enqueue помечает ImportLog как failed', async () => {
    const { svc, prisma, queueAdd } = makeService();
    queueAdd.mockRejectedValueOnce(new Error('redis down'));
    await expect(
      svc.start({
        tenantId: 't1',
        userId: 'u1',
        source: 'trello',
        paramsJson: { foo: 'bar' },
      }),
    ).rejects.toThrow('redis down');
    expect(prisma.importLog.update).toHaveBeenCalledTimes(1);
    const updateData = prisma.importLog.update.mock.calls[0]?.[0]
      ?.data as Record<string, unknown>;
    expect(updateData.status).toBe('failed');
    expect(updateData.completedAt).toBeInstanceOf(Date);
  });
});

describe('ImportService.cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('404 если ImportLog не найден', async () => {
    const { svc, prisma } = makeService();
    prisma.importLog.findFirst.mockResolvedValueOnce(null);
    await expect(
      svc.cancel({ tenantId: 't1', importLogId: 'missing' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('помечает status=cancelled если был running', async () => {
    const { svc, prisma } = makeService();
    prisma.importLog.findFirst.mockResolvedValueOnce({
      id: 'imp-1',
      tenantId: 't1',
      source: 'trello',
      status: 'running',
      startedAt: new Date(),
      completedAt: null,
      totalProjects: 0,
      totalIssues: 0,
      totalComments: 0,
      totalAttachments: 0,
      processedItems: 0,
      errors: null,
      paramsJson: null,
      unmatchedJson: null,
      initiatedByUserId: 'u1',
    });
    const out = await svc.cancel({ tenantId: 't1', importLogId: 'imp-1' });
    expect(out.status).toBe('cancelled');
    expect(prisma.importLog.update).toHaveBeenCalledTimes(1);
  });

  it('идемпотентно: не трогает status если уже completed', async () => {
    const { svc, prisma } = makeService();
    prisma.importLog.findFirst.mockResolvedValueOnce({
      id: 'imp-2',
      tenantId: 't1',
      source: 'trello',
      status: 'completed',
      startedAt: new Date(),
      completedAt: new Date(),
      totalProjects: 1,
      totalIssues: 5,
      totalComments: 2,
      totalAttachments: 0,
      processedItems: 5,
      errors: null,
      paramsJson: null,
      unmatchedJson: null,
      initiatedByUserId: 'u1',
    });
    const out = await svc.cancel({ tenantId: 't1', importLogId: 'imp-2' });
    expect(out.status).toBe('completed');
    expect(prisma.importLog.update).not.toHaveBeenCalled();
  });
});

describe('ImportService.list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('возвращает items + nextCursor когда есть следующая страница', async () => {
    const { svc, prisma } = makeService();
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: `imp-${i}`,
      tenantId: 't1',
      source: 'trello',
      status: 'completed',
      startedAt: new Date(),
      completedAt: new Date(),
      totalProjects: 0,
      totalIssues: 0,
      totalComments: 0,
      totalAttachments: 0,
      processedItems: 0,
      errors: null,
      paramsJson: null,
      unmatchedJson: null,
      initiatedByUserId: 'u1',
    }));
    prisma.importLog.findMany.mockResolvedValueOnce(rows);
    const out = await svc.list({ tenantId: 't1', limit: 2 });
    expect(out.items).toHaveLength(2);
    expect(out.nextCursor).toBe('imp-1'); // последний из pageItems
  });

  it('nextCursor=null когда rows ≤ limit', async () => {
    const { svc, prisma } = makeService();
    prisma.importLog.findMany.mockResolvedValueOnce([]);
    const out = await svc.list({ tenantId: 't1', limit: 5 });
    expect(out.items).toEqual([]);
    expect(out.nextCursor).toBeNull();
  });
});
