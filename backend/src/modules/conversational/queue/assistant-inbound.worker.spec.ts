/**
 * Spec для AssistantInboundWorker (Ф1 calendar-master, 2026-06-18).
 *
 * Тестируем только метод `process(job)` — он зовёт
 * `ConversationalService.dispatchInbound(job.data.inbound)`. Реальный
 * BullMQ Worker / Redis НЕ поднимаем (это интеграционная зона); проверяем
 * чистый контракт «достал inbound из job'а → отдал в dispatchInbound».
 */
import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import type { RedisService } from '../../../common/redis/redis.service';
import type { ConversationalService } from '../conversational.service';

import type { AssistantInboundJobData } from './assistant-inbound-queue';
import { AssistantInboundWorker } from './assistant-inbound.worker';

function build() {
  const dispatchInbound = vi.fn(async () => undefined);
  const conversational = {
    dispatchInbound,
  } as unknown as ConversationalService;
  // Worker не зовёт redis из process() — достаточно пустого stub'а.
  const redis = { client: {} } as unknown as RedisService;

  const worker = new AssistantInboundWorker(redis, conversational);
  return { worker, conversational, dispatchInbound };
}

describe('AssistantInboundWorker.process', () => {
  it('зовёт dispatchInbound с inbound из job.data', async () => {
    const { worker, dispatchInbound } = build();
    const inbound = {
      type: 'assistant_turn',
      userId: 'u',
      tenantId: 't',
      text: 'привет',
    };
    const job = {
      data: { inbound } as AssistantInboundJobData,
    } as Job<AssistantInboundJobData>;

    await worker.process(job);

    expect(dispatchInbound).toHaveBeenCalledOnce();
    expect(dispatchInbound).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'assistant_turn', text: 'привет' }),
    );
  });
});
