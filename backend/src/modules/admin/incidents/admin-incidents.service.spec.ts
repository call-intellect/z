import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RedisService } from '../../../common/redis/redis.service';

import { AdminIncidentsService } from './admin-incidents.service';

type FailedJob = {
  id: string;
  name: string;
  failedReason: string | null;
  timestamp: number | null;
  attemptsMade: number;
  stacktrace: string[] | undefined;
};
const queueData = new Map<string, { counts: Record<string, number>; failed: FailedJob[] }>();

vi.mock('bullmq', () => {
  class MockQueue {
    constructor(
      public readonly name: string,
      _opts?: unknown,
    ) {}
    async getJobCounts(..._args: string[]): Promise<Record<string, number>> {
      return queueData.get(this.name)?.counts ?? {};
    }
    async getFailed(_start: number, _end: number): Promise<FailedJob[]> {
      return queueData.get(this.name)?.failed ?? [];
    }
    async close(): Promise<void> {}
  }
  return { Queue: MockQueue };
});

function buildService(): { svc: AdminIncidentsService } {
  const redis = { client: {} } as unknown as RedisService;
  const svc = new AdminIncidentsService(redis);
  return { svc };
}

function setQueueMock(
  name: string,
  data: {
    counts: Record<string, number>;
    failed?: FailedJob[];
  },
): void {
  queueData.set(name, { counts: data.counts, failed: data.failed ?? [] });
}

describe('AdminIncidentsService', () => {
  beforeEach(() => {
    queueData.clear();
  });

  it('getKnownQueueNames() содержит ai.*, core.*, tracker.* очереди', () => {
    const { svc } = buildService();
    const names = svc.getKnownQueueNames();
    expect(names).toContain('ai.transcribe');
    expect(names).toContain('core.raw-events');
    expect(names).toContain('tracker.webhook-delivery');
    expect(new Set(names).size).toBe(names.length);
  });

  it('getQueueSummary() возвращает counts + recentFailed', async () => {
    const { svc } = buildService();
    setQueueMock('ai.transcribe', {
      counts: { failed: 2, completed: 100 },
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
    });

    const summary = await svc.getQueueSummary('ai.transcribe');
    expect(summary.queueName).toBe('ai.transcribe');
    expect(summary.counts.failed).toBe(2);
    expect(summary.recentFailed.length).toBe(1);
    expect(summary.recentFailed[0]?.failedReason).toBe('timeout');
    expect(summary.recentFailed[0]?.stacktraceExcerpt).toContain('Error: timeout');
  });

  it('listIncidents() сортирует очереди с failed первыми', async () => {
    const { svc } = buildService();
    setQueueMock('ai.transcribe', { counts: { failed: 0 } });
    setQueueMock('ai.analyze', { counts: { failed: 5 } });
    setQueueMock('core.raw-events', { counts: { failed: 2 } });

    const list = await svc.listIncidents();
    expect(list[0]?.queueName).toBe('ai.analyze');
    expect(list[1]?.queueName).toBe('core.raw-events');
    const zeros = list.filter((i) => (i.counts.failed ?? 0) === 0);
    expect(zeros.length).toBeGreaterThan(0);
  });

  it('createRule() сохраняет в памяти + помечает mvpInactive', () => {
    const { svc } = buildService();
    const rule = svc.createRule({
      name: 'high-failure',
      trigger: 'queue_failed',
      condition: 'failed > 10',
      channel: 'log',
      enabled: true,
    });
    expect(rule.id).toBeTruthy();
    expect(rule.mvpInactive).toBe(true);
    expect(svc.listRules()).toHaveLength(1);
  });

  it('deleteRule() удаляет из памяти', () => {
    const { svc } = buildService();
    const rule = svc.createRule({
      name: 'x',
      trigger: 'manual',
      condition: 'x',
      channel: 'log',
      enabled: true,
    });
    expect(svc.deleteRule(rule.id)).toBe(true);
    expect(svc.listRules()).toHaveLength(0);
    expect(svc.deleteRule('missing')).toBe(false);
  });

  it("recentFailed — обрезает stacktrace до excerpt'а ≤800 символов", async () => {
    const { svc } = buildService();
    const longLine = 'x'.repeat(2000);
    setQueueMock('ai.merge', {
      counts: { failed: 1 },
      failed: [
        {
          id: 'big',
          name: 'merge',
          failedReason: null,
          timestamp: null,
          attemptsMade: 1,
          stacktrace: [longLine],
        },
      ],
    });
    const summary = await svc.getQueueSummary('ai.merge');
    expect(summary.recentFailed[0]?.stacktraceExcerpt?.length).toBeLessThanOrEqual(801);
  });
});
