import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { CoreQueueService } from '../../core-queue/core-queue.service';

import { SprintHelperCron } from './sprint-helper.cron';

/**
 * Unit-тесты SprintHelperCron (audit-fixes §Б10).
 *
 * Покрытие:
 *  1. Запрос идёт через $queryRaw (window function).
 *  2. enqueueSprintHelper вызывается ровно по числу возвращённых cycles.
 *  3. tenantId пробрасывается корректно.
 *  4. При пустом результате — никаких enqueue.
 *  5. Ошибка в $queryRaw не валит cron (логируется и возвращает).
 */

interface FakeCycleRow {
  id: string;
  tenantId: string;
}

function makeCron(rows: FakeCycleRow[] | Error): {
  cron: SprintHelperCron;
  enqueueCalls: Array<{ cycleId: string; tenantId: string; reason: string }>;
  queryRaw: ReturnType<typeof vi.fn>;
} {
  const queryRaw = vi.fn(async () => {
    if (rows instanceof Error) throw rows;
    return rows;
  });
  const prisma = {
    $queryRaw: queryRaw,
  } as unknown as PrismaService;
  const enqueueCalls: Array<{
    cycleId: string;
    tenantId: string;
    reason: string;
  }> = [];
  const coreQueue = {
    enqueueSprintHelper: vi.fn(async (data: { cycleId: string; tenantId: string; reason: string }) => {
      enqueueCalls.push(data);
    }),
  } as unknown as CoreQueueService;
  const cron = new SprintHelperCron(prisma, coreQueue);
  return { cron, enqueueCalls, queryRaw };
}

describe('SprintHelperCron (Б10)', () => {
  it('enqueue: получает rows из $queryRaw и шлёт enqueueSprintHelper для каждого', async () => {
    const { cron, enqueueCalls, queryRaw } = makeCron([
      { id: 'c-1', tenantId: 't-1' },
      { id: 'c-2', tenantId: 't-1' },
      { id: 'c-3', tenantId: 't-2' },
    ]);

    await cron.tick();

    expect(queryRaw).toHaveBeenCalledOnce();
    expect(enqueueCalls).toHaveLength(3);
    expect(enqueueCalls.map((c) => c.cycleId).sort()).toEqual([
      'c-1',
      'c-2',
      'c-3',
    ]);
    expect(enqueueCalls.every((c) => c.reason === 'cron')).toBe(true);
    // Все tenantId сохранены
    const tenants = new Set(enqueueCalls.map((c) => c.tenantId));
    expect(tenants).toEqual(new Set(['t-1', 't-2']));
  });

  it('пустой результат: 0 enqueue', async () => {
    const { cron, enqueueCalls, queryRaw } = makeCron([]);
    await cron.tick();
    expect(queryRaw).toHaveBeenCalledOnce();
    expect(enqueueCalls).toHaveLength(0);
  });

  it('ошибка $queryRaw: не падает, логирует, возвращается', async () => {
    const { cron, enqueueCalls } = makeCron(new Error('db down'));
    await expect(cron.tick()).resolves.toBeUndefined();
    expect(enqueueCalls).toHaveLength(0);
  });

  it('per-tenant cap зашит как 5, global hard cap 500', () => {
    // Проверка инвариантов: cap не уехал случайно при правке.
    const klass = SprintHelperCron as unknown as {
      PER_TENANT_CAP: number;
      GLOBAL_HARD_CAP: number;
    };
    expect(klass.PER_TENANT_CAP).toBe(5);
    expect(klass.GLOBAL_HARD_CAP).toBe(500);
  });
});
