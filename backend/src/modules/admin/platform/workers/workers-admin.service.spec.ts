/**
 * Admin-redesign Фаза 8 — unit-тесты `WorkersAdminService`.
 *
 * Покрываем:
 *   1) listQueues() — собирает counts + isPaused по объединённому списку имён.
 *   2) getQueueDetail() — отдает recentFailed/recentCompleted + processingRate.
 *   3) retryFailed() — вызывает Queue.retryJobs и возвращает count.
 *   4) deleteFailedJob() — 404 если job не найден.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RedisService } from '../../../../common/redis/redis.service';

import { WorkersAdminService } from './workers-admin.service';

interface FailedJobShape {
  id: string;
  name: string;
  failedReason: string | null;
  timestamp: number | null;
  attemptsMade: number;
  stacktrace: string[] | undefined;
}

interface CompletedJobShape {
  id: string;
  name: string;
  finishedOn: number | null;
  processedOn: number | null;
}

interface QueueState {
  counts: Record<string, number>;
  failed: FailedJobShape[];
  completed: CompletedJobShape[];
  isPaused: boolean;
  retried?: number;
}

const queueData = new Map<string, QueueState>();
const removedJobs = new Set<string>();
const retryCalls = new Map<string, number>();
const pauseCalls = new Set<string>();
const resumeCalls = new Set<string>();

vi.mock('bullmq', () => {
  class MockQueue {
    constructor(
      public readonly name: string,
      _opts?: unknown,
    ) {}
    async getJobCounts(..._args: string[]): Promise<Record<string, number>> {
      return queueData.get(this.name)?.counts ?? {};
    }
    async getFailed(_start: number, _end: number): Promise<FailedJobShape[]> {
      return queueData.get(this.name)?.failed ?? [];
    }
    async getCompleted(
      _start: number,
      _end: number,
    ): Promise<CompletedJobShape[]> {
      return queueData.get(this.name)?.completed ?? [];
    }
    async isPaused(): Promise<boolean> {
      return queueData.get(this.name)?.isPaused ?? false;
    }
    async retryJobs(_opts: { state: string; count?: number }): Promise<void> {
      retryCalls.set(this.name, (retryCalls.get(this.name) ?? 0) + 1);
    }
    async pause(): Promise<void> {
      pauseCalls.add(this.name);
    }
    async resume(): Promise<void> {
      resumeCalls.add(this.name);
    }
    async getJob(jobId: string): Promise<{
      id: string;
      remove: () => Promise<void>;
    } | null> {
      const found = queueData
        .get(this.name)
        ?.failed.find((j) => j.id === jobId);
      if (!found) return null;
      return {
        id: found.id,
        remove: async () => {
          removedJobs.add(`${this.name}:${found.id}`);
        },
      };
    }
    async close(): Promise<void> {}
  }
  return { Queue: MockQueue };
});

function buildService(): { svc: WorkersAdminService } {
  const redis = { client: {} } as unknown as RedisService;
  const svc = new WorkersAdminService(redis);
  return { svc };
}

describe('WorkersAdminService', () => {
  beforeEach(() => {
    queueData.clear();
    removedJobs.clear();
    retryCalls.clear();
    pauseCalls.clear();
    resumeCalls.clear();
  });

  it('listQueues(): собирает counts + isPaused по известному списку', async () => {
    const { svc } = buildService();
    const names = svc.getKnownQueueNames();
    expect(names.length).toBeGreaterThan(0);
    queueData.set(names[0]!, {
      counts: { waiting: 3, active: 1, failed: 5, delayed: 0, completed: 100, paused: 0 },
      failed: [],
      completed: [],
      isPaused: true,
    });

    const list = await svc.listQueues();
    const first = list.find((q) => q.name === names[0]);
    expect(first).toBeTruthy();
    expect(first?.counts.failed).toBe(5);
    expect(first?.counts.waiting).toBe(3);
    expect(first?.isPaused).toBe(true);
    // 404-логика: имя не из known — сюда не попадает
    expect(list.every((q) => names.includes(q.name))).toBe(true);
  });

  it('getQueueDetail(): отдает recentFailed/recentCompleted + processingRate', async () => {
    const { svc } = buildService();
    const known = svc.getKnownQueueNames()[0]!;
    const oneMinAgo = Date.now() - 60 * 1000;
    queueData.set(known, {
      counts: { failed: 2, completed: 10 },
      failed: [
        {
          id: 'job-1',
          name: 'transcribe',
          failedReason: 'timeout',
          timestamp: 12345,
          attemptsMade: 3,
          stacktrace: ['Error: timeout', '  at foo (a.ts:10)'],
        },
      ],
      completed: [
        {
          id: 'c-1',
          name: 'transcribe',
          finishedOn: oneMinAgo,
          processedOn: oneMinAgo - 500,
        },
      ],
      isPaused: false,
    });

    const detail = await svc.getQueueDetail(known);
    expect(detail.recentFailed.length).toBe(1);
    expect(detail.recentFailed[0]?.failedReason).toBe('timeout');
    expect(detail.recentFailed[0]?.stacktraceExcerpt).toContain('Error: timeout');
    expect(detail.recentCompleted.length).toBe(1);
    expect(detail.recentCompleted[0]?.durationMs).toBe(500);
    expect(detail.processingRatePerHour).toBe(1);
  });

  it('getQueueDetail(): 404 для неизвестной очереди', async () => {
    const { svc } = buildService();
    await expect(svc.getQueueDetail('some.unknown.queue')).rejects.toThrow();
  });

  it('retryFailed(): зовёт Queue.retryJobs и возвращает count', async () => {
    const { svc } = buildService();
    const known = svc.getKnownQueueNames()[0]!;
    queueData.set(known, {
      counts: { failed: 7 },
      failed: [],
      completed: [],
      isPaused: false,
    });
    const res = await svc.retryFailed(known);
    expect(res.ok).toBe(true);
    expect(res.retried).toBe(7);
    expect(retryCalls.get(known)).toBe(1);
  });

  it('pause()/resume() вызывают соответствующие методы Queue', async () => {
    const { svc } = buildService();
    const known = svc.getKnownQueueNames()[0]!;
    queueData.set(known, {
      counts: {},
      failed: [],
      completed: [],
      isPaused: false,
    });
    await svc.pause(known);
    expect(pauseCalls.has(known)).toBe(true);
    await svc.resume(known);
    expect(resumeCalls.has(known)).toBe(true);
  });

  it('deleteFailedJob(): 404 если job не найден', async () => {
    const { svc } = buildService();
    const known = svc.getKnownQueueNames()[0]!;
    queueData.set(known, {
      counts: {},
      failed: [],
      completed: [],
      isPaused: false,
    });
    await expect(
      svc.deleteFailedJob(known, 'nope'),
    ).rejects.toThrow();
  });

  it('deleteFailedJob(): удаляет существующий failed job', async () => {
    const { svc } = buildService();
    const known = svc.getKnownQueueNames()[0]!;
    queueData.set(known, {
      counts: {},
      failed: [
        {
          id: 'job-x',
          name: 'transcribe',
          failedReason: null,
          timestamp: null,
          attemptsMade: 1,
          stacktrace: undefined,
        },
      ],
      completed: [],
      isPaused: false,
    });
    const res = await svc.deleteFailedJob(known, 'job-x');
    expect(res.ok).toBe(true);
    expect(removedJobs.has(`${known}:job-x`)).toBe(true);
  });
});
