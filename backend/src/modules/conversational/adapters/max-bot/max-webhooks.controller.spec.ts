import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../../common/config';
import type { PrismaService } from '../../../../common/prisma/prisma.service';
import type { RedisService } from '../../../../common/redis/redis.service';
import type { ConversationalService } from '../../conversational.service';
import type { AssistantInboundQueueService } from '../../queue/assistant-inbound-queue.service';

import type { MaxBotChannelAdapter } from './max-bot.adapter';
import { MaxWebhooksController } from './max-webhooks.controller';

const SECRET = 'max-secret-shared-32characters!!';

function build(opts: {
  channel?: { id?: string; status: string } | null;
  readSecret?: string | null;
  adapterIngestReturns?: 'inbound' | 'null' | 'throw';
  dispatchThrows?: boolean;
  redisSet?: 'OK' | 'null' | 'throw';
  asyncEnabled?: boolean;
  enqueueThrows?: boolean;
} = {}) {
  const channel =
    opts.channel === undefined ? { id: 'ch-max-1', status: 'active' } : opts.channel;
  const prisma = {
    channel: {
      findUnique: vi.fn(async () => channel),
    },
  } as unknown as PrismaService;

  const adapter = {
    readWebhookSecret: vi.fn(() => {
      if (opts.readSecret === null) throw new Error('cannot decrypt');
      return opts.readSecret ?? SECRET;
    }),
    ingestUpdate: vi.fn(async () => {
      if (opts.adapterIngestReturns === 'throw') throw new Error('ingest fail');
      if (opts.adapterIngestReturns === 'null') return null;
      return { type: 'max_msg' } as never;
    }),
  } as unknown as MaxBotChannelAdapter;

  const conversational = {
    dispatchInbound: vi.fn(async () => {
      if (opts.dispatchThrows) throw new Error('dispatch fail');
    }),
  } as unknown as ConversationalService;

  const redisSet = vi.fn(async () => {
    if (opts.redisSet === 'throw') throw new Error('redis down');
    if (opts.redisSet === 'null') return null;
    return 'OK';
  });
  const redis = {
    client: { set: redisSet },
  } as unknown as RedisService;

  const cfg = {
    bot: { assistantInboundAsyncEnabled: opts.asyncEnabled ?? false },
  } as unknown as TypedConfigService;

  const enqueue = vi.fn(async () => {
    if (opts.enqueueThrows) throw new Error('enqueue fail');
  });
  const inboundQueue = { enqueue } as unknown as AssistantInboundQueueService;

  const ctrl = new MaxWebhooksController(
    prisma,
    adapter,
    conversational,
    redis,
    cfg,
    inboundQueue,
  );
  return { ctrl, prisma, adapter, conversational, redisSet, cfg, inboundQueue };
}

const validBody = {
  update_type: 'message_created',
  timestamp: 1700000000,
  message: { sender: { user_id: 1 }, body: { text: 'hi' } },
};

describe('MaxWebhooksController', () => {
  it('happy: вызывает ingestUpdate + dispatchInbound', async () => {
    const { ctrl, adapter, conversational } = build();
    const res = await ctrl.receive('tenant-1', SECRET, validBody as never);
    expect(res).toEqual({ ok: true });
    expect(adapter.ingestUpdate).toHaveBeenCalledOnce();
    expect(conversational.dispatchInbound).toHaveBeenCalledOnce();
  });

  it('404 если Channel отсутствует', async () => {
    const { ctrl } = build({ channel: null });
    await expect(ctrl.receive('tenant-1', SECRET, validBody as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404 если канал неактивен', async () => {
    const { ctrl } = build({ channel: { status: 'disabled' } });
    await expect(ctrl.receive('tenant-1', SECRET, validBody as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('403 invalid_webhook_secret если secret в URL не совпал', async () => {
    const { ctrl } = build();
    await expect(
      ctrl.receive('tenant-1', 'wrong-secret-of-same-length-12345', validBody as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('403 webhook_secret_unreadable если расшифровка падает', async () => {
    const { ctrl } = build({ readSecret: null });
    await expect(ctrl.receive('tenant-1', SECRET, validBody as never)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('200 (НЕ 5xx) если adapter.ingestUpdate бросает', async () => {
    const { ctrl, conversational } = build({ adapterIngestReturns: 'throw' });
    const res = await ctrl.receive('tenant-1', SECRET, validBody as never);
    expect(res).toEqual({ ok: true });
    expect(conversational.dispatchInbound).not.toHaveBeenCalled();
  });

  it('200 если adapter вернул null', async () => {
    const { ctrl, conversational } = build({ adapterIngestReturns: 'null' });
    const res = await ctrl.receive('tenant-1', SECRET, validBody as never);
    expect(res).toEqual({ ok: true });
    expect(conversational.dispatchInbound).not.toHaveBeenCalled();
  });

  it('200 если dispatchInbound бросает', async () => {
    const { ctrl } = build({ dispatchThrows: true });
    const res = await ctrl.receive('tenant-1', SECRET, validBody as never);
    expect(res).toEqual({ ok: true });
  });
});

describe('MaxWebhooksController — Ф1 дедуп по mid + ранний ACK', () => {
  const bodyM1 = {
    update_type: 'message_created',
    timestamp: 1700000000,
    message: { sender: { user_id: 1 }, body: { mid: 'm1', text: 'привет' } },
  };

  it('async ON: первый mid=m1 (SET=OK) → enqueue вызван, dispatch НЕ вызван', async () => {
    const { ctrl, redisSet, inboundQueue, conversational } = build({
      asyncEnabled: true,
    });
    const res = await ctrl.receive('tenant-1', SECRET, bodyM1 as never);
    expect(res).toEqual({ ok: true });
    expect(redisSet).toHaveBeenCalledWith(
      'max:update:ch-max-1:m1',
      '1',
      'EX',
      3600,
      'NX',
    );
    expect(inboundQueue.enqueue).toHaveBeenCalledOnce();
    expect(inboundQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        inbound: expect.objectContaining({ type: 'max_msg' }),
        dedupeId: 'ch-max-1_m1',
      }),
    );
    expect(conversational.dispatchInbound).not.toHaveBeenCalled();
  });

  it('дубль: SET=null → ни enqueue, ни dispatch (адаптер тоже не дёргается)', async () => {
    const { ctrl, inboundQueue, conversational, adapter } = build({
      asyncEnabled: true,
      redisSet: 'null',
    });
    const res = await ctrl.receive('tenant-1', SECRET, bodyM1 as never);
    expect(res).toEqual({ ok: true });
    expect(adapter.ingestUpdate).not.toHaveBeenCalled();
    expect(inboundQueue.enqueue).not.toHaveBeenCalled();
    expect(conversational.dispatchInbound).not.toHaveBeenCalled();
  });

  it('async OFF: dispatch вызван, enqueue НЕ вызван', async () => {
    const { ctrl, inboundQueue, conversational } = build({
      asyncEnabled: false,
    });
    const res = await ctrl.receive('tenant-1', SECRET, bodyM1 as never);
    expect(res).toEqual({ ok: true });
    expect(conversational.dispatchInbound).toHaveBeenCalledOnce();
    expect(inboundQueue.enqueue).not.toHaveBeenCalled();
  });
});
