import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RedisService } from '../../../common/redis/redis.service';
import type { PushSendJobData } from '../../core-queue/queues';
import type { WebPushSender } from '../services/web-push-sender.service';

import { PushSenderWorker } from './push-sender.worker';

function build(): {
  worker: PushSenderWorker;
  sender: { sendToUser: ReturnType<typeof vi.fn> };
} {
  const sender = {
    sendToUser: vi
      .fn()
      .mockResolvedValue({ delivered: 1, failed: 0 }),
  };
  const redis = { client: {} } as unknown as RedisService;
  const worker = new PushSenderWorker(
    redis,
    sender as unknown as WebPushSender,
  );
  return { worker, sender };
}

function jobOf(data: PushSendJobData): Job<PushSendJobData> {
  return { id: 'job-1', data, attemptsMade: 0 } as unknown as Job<PushSendJobData>;
}

describe('PushSenderWorker.process', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('делегирует sender.sendToUser с tenantId/userId/title/body', async () => {
    const { worker, sender } = build();
    await worker.process(
      jobOf({
        tenantId: 't-1',
        userId: 'u-1',
        title: 'Привет',
        body: 'У тебя новая задача',
      }),
    );
    expect(sender.sendToUser).toHaveBeenCalledWith({
      tenantId: 't-1',
      userId: 'u-1',
      title: 'Привет',
      body: 'У тебя новая задача',
    });
  });

  it('извлекает url из data и кладёт остаток в extraData', async () => {
    const { worker, sender } = build();
    await worker.process(
      jobOf({
        tenantId: 't-1',
        userId: 'u-1',
        title: 'Hi',
        body: 'New thanks',
        icon: '/icon-192.png',
        data: { url: 'https://kora.app/inbox', kind: 'thanks', recId: 'rec-1' },
      }),
    );
    const args = sender.sendToUser.mock.calls[0]?.[0];
    expect(args.icon).toBe('/icon-192.png');
    expect(args.url).toBe('https://kora.app/inbox');
    expect(args.extraData).toEqual({ kind: 'thanks', recId: 'rec-1' });
  });

  it('без url в data — args.url отсутствует', async () => {
    const { worker, sender } = build();
    await worker.process(
      jobOf({
        tenantId: 't-1',
        userId: 'u-1',
        title: 'T',
        body: 'B',
        data: { kind: 'other' },
      }),
    );
    const args = sender.sendToUser.mock.calls[0]?.[0];
    expect(args.url).toBeUndefined();
    expect(args.extraData).toEqual({ kind: 'other' });
  });
});
