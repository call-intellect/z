/**
 * Spec для TelegramWebhooksController.
 *
 * Покрытие:
 *   - β-9 (новый путь) `POST /api/v1/webhooks/telegram-bot` без `:tenantId`
 *     лукапит глобальный канал и не передаёт tenantId в adapter.ingestUpdate.
 *   - β-9 (legacy `:tenantId`) — если глобальный канал существует, использует
 *     его, пишет warn про deprecation; иначе fallback на per-tenant.
 *   - 404 если глобального канала нет (новый путь).
 *   - 403 invalid_webhook_secret / webhook_secret_unreadable.
 *   - 200 без 5xx если adapter.ingestUpdate бросает.
 *   - 200 если ingestUpdate вернул null.
 *   - 200 если dispatchInbound бросает.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../../common/prisma/prisma.service';
import type { RedisService } from '../../../../common/redis/redis.service';
import type { ConversationalService } from '../../conversational.service';

import type { TelegramBotChannelAdapter } from './telegram-bot.adapter';
import { TelegramWebhooksController } from './telegram-webhooks.controller';

const SECRET = 'webhook-secret-42';

function build(opts: {
  /** Какой канал вернёт `findFirst({ tenantId: null })`. По умолчанию — глобальный активный. */
  globalChannel?: { id: string; status: string } | null;
  /** Какой канал вернёт `findUnique({ tenantId_kind })` для legacy пути. По умолчанию — null. */
  perTenantChannel?: { id: string; status: string } | null;
  readSecret?: string | null;
  adapterIngestReturns?: 'inbound' | 'null' | 'throw';
  dispatchThrows?: boolean;
} = {}) {
  const globalChannel = opts.globalChannel === undefined
    ? { id: 'global-1', status: 'active' }
    : opts.globalChannel;
  const perTenantChannel = opts.perTenantChannel === undefined
    ? null
    : opts.perTenantChannel;

  const prisma = {
    channel: {
      findFirst: vi.fn(async () => globalChannel),
      findUnique: vi.fn(async () => perTenantChannel),
    },
  } as unknown as PrismaService;

  const adapter = {
    readWebhookSecret: vi.fn(() => {
      if (opts.readSecret === null) {
        throw new Error('cannot decrypt');
      }
      return opts.readSecret ?? SECRET;
    }),
    ingestUpdate: vi.fn(async () => {
      if (opts.adapterIngestReturns === 'throw') {
        throw new Error('ingest fail');
      }
      if (opts.adapterIngestReturns === 'null') return null;
      return { type: 'tg_msg' } as never;
    }),
  } as unknown as TelegramBotChannelAdapter;

  const conversational = {
    dispatchInbound: vi.fn(async () => {
      if (opts.dispatchThrows) throw new Error('dispatch fail');
    }),
  } as unknown as ConversationalService;

  const metrics = {
    incTelegramBotGlobalWebhookReceived: vi.fn(),
  } as unknown as BusinessMetricsService;

  // Minimal Redis stub. duplicate() возвращает subscriber-объект с no-op
  // методами; в unit'ах pub/sub-инвалидация не интегрируется, тестируется
  // отдельно в Фазе 4.
  const subscriber = {
    subscribe: vi.fn(async () => undefined),
    on: vi.fn(),
    quit: vi.fn(async () => undefined),
  };
  const redis = {
    client: { duplicate: vi.fn(() => subscriber) },
  } as unknown as RedisService;

  const ctrl = new TelegramWebhooksController(
    prisma,
    adapter,
    conversational,
    metrics,
    redis,
  );
  return { ctrl, prisma, adapter, conversational, metrics, redis, subscriber };
}

const validBody = {
  update_id: 1,
  message: {
    message_id: 10,
    chat: { id: 100, type: 'private' },
    from: { id: 5, is_bot: false },
    text: 'hi',
    date: 1700000000,
  },
};

describe('TelegramWebhooksController — β-9 глобальный путь', () => {
  beforeEach(() => vi.clearAllMocks());

  it('happy: глобальный webhook без :tenantId → ingestUpdate(tenantId=undefined) + dispatch', async () => {
    const { ctrl, adapter, conversational, metrics } = build();
    const res = await ctrl.receiveGlobal(validBody as never, SECRET);
    expect(res).toEqual({ ok: true });
    expect(adapter.ingestUpdate).toHaveBeenCalledOnce();
    expect(
      vi.mocked(adapter.ingestUpdate).mock.calls[0]![0].tenantId,
    ).toBeUndefined();
    expect(conversational.dispatchInbound).toHaveBeenCalledOnce();
    expect(metrics.incTelegramBotGlobalWebhookReceived).toHaveBeenCalledWith({
      type: 'message',
    });
  });

  it('404 если глобального канала нет', async () => {
    const { ctrl } = build({ globalChannel: null });
    await expect(
      ctrl.receiveGlobal(validBody as never, SECRET),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404 если глобальный канал в статусе global_disabled (или paused)', async () => {
    const { ctrl } = build({
      globalChannel: { id: 'g', status: 'global_disabled' },
    });
    await expect(
      ctrl.receiveGlobal(validBody as never, SECRET),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('403 если secret не совпадает', async () => {
    const { ctrl } = build();
    await expect(
      ctrl.receiveGlobal(validBody as never, 'wrong-secret-padded-1234'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('403 если secret не читается', async () => {
    const { ctrl } = build({ readSecret: null });
    await expect(
      ctrl.receiveGlobal(validBody as never, SECRET),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('200 если adapter.ingestUpdate бросает (Telegram не должен ретраить)', async () => {
    const { ctrl, conversational } = build({ adapterIngestReturns: 'throw' });
    const res = await ctrl.receiveGlobal(validBody as never, SECRET);
    expect(res).toEqual({ ok: true });
    expect(conversational.dispatchInbound).not.toHaveBeenCalled();
  });

  it('200 если ingestUpdate вернул null', async () => {
    const { ctrl, conversational } = build({ adapterIngestReturns: 'null' });
    const res = await ctrl.receiveGlobal(validBody as never, SECRET);
    expect(res).toEqual({ ok: true });
    expect(conversational.dispatchInbound).not.toHaveBeenCalled();
  });

  it('200 если dispatchInbound бросает', async () => {
    const { ctrl } = build({ dispatchThrows: true });
    const res = await ctrl.receiveGlobal(validBody as never, SECRET);
    expect(res).toEqual({ ok: true });
  });
});

describe('TelegramWebhooksController — legacy :tenantId путь', () => {
  beforeEach(() => vi.clearAllMocks());

  it('если глобальный канал есть — использует его, игнорит tenantId из URL', async () => {
    const { ctrl, adapter } = build();
    const res = await ctrl.receive('tenant-x', validBody as never, SECRET);
    expect(res).toEqual({ ok: true });
    // tenantId не пробрасывается в адаптер — резолв через Membership.
    expect(
      vi.mocked(adapter.ingestUpdate).mock.calls[0]![0].tenantId,
    ).toBeUndefined();
  });

  it('если глобального нет — fallback на per-tenant Channel', async () => {
    const { ctrl, adapter } = build({
      globalChannel: null,
      perTenantChannel: { id: 'pt-1', status: 'active' },
    });
    const res = await ctrl.receive('tenant-1', validBody as never, SECRET);
    expect(res).toEqual({ ok: true });
    // tenantId передаётся в адаптер (legacy режим).
    expect(
      vi.mocked(adapter.ingestUpdate).mock.calls[0]![0].tenantId,
    ).toBe('tenant-1');
  });

  it('404 если ни глобального, ни per-tenant нет', async () => {
    const { ctrl } = build({ globalChannel: null, perTenantChannel: null });
    await expect(
      ctrl.receive('tenant-x', validBody as never, SECRET),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('TelegramWebhooksController — pub/sub invalidation (2026-05-26 Phase 4)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('onModuleInit подписывается на TELEGRAM_GLOBAL_CHANNEL_UPDATED_TOPIC', async () => {
    const { ctrl, subscriber } = build();
    await ctrl.onModuleInit();
    expect(subscriber.subscribe).toHaveBeenCalledWith(
      'conversational:channel:updated:telegram_bot',
    );
    expect(subscriber.on).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('после события pub/sub кэш сбрасывается и при следующем webhook делается новый findFirst', async () => {
    const { ctrl, prisma, subscriber } = build();
    await ctrl.onModuleInit();
    // Первый запрос — кэш промахивается, findFirst вызывается.
    await ctrl.receiveGlobal(validBody as never, SECRET);
    expect(prisma.channel.findFirst).toHaveBeenCalledTimes(1);
    // Второй запрос — кэш hit, findFirst НЕ дёргается.
    await ctrl.receiveGlobal(validBody as never, SECRET);
    expect(prisma.channel.findFirst).toHaveBeenCalledTimes(1);
    // Эмулируем pub/sub-сообщение → сбрасывает кэш.
    const handler = (subscriber.on as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as (channel: string) => void;
    handler('conversational:channel:updated:telegram_bot');
    // Третий запрос — снова промах, findFirst дёргается.
    await ctrl.receiveGlobal(validBody as never, SECRET);
    expect(prisma.channel.findFirst).toHaveBeenCalledTimes(2);
  });

  it('сообщение в чужом топике не сбрасывает кэш', async () => {
    const { ctrl, prisma, subscriber } = build();
    await ctrl.onModuleInit();
    await ctrl.receiveGlobal(validBody as never, SECRET);
    expect(prisma.channel.findFirst).toHaveBeenCalledTimes(1);
    const handler = (subscriber.on as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as (channel: string) => void;
    handler('some:other:topic');
    await ctrl.receiveGlobal(validBody as never, SECRET);
    // Только один findFirst — кэш не сбросился.
    expect(prisma.channel.findFirst).toHaveBeenCalledTimes(1);
  });

  it('onModuleDestroy закрывает subscriber-соединение', async () => {
    const { ctrl, subscriber } = build();
    await ctrl.onModuleInit();
    await ctrl.onModuleDestroy();
    expect(subscriber.quit).toHaveBeenCalledOnce();
  });
});
