/**
 * Spec для TelegramWebhooksController (Phase F.5).
 *
 * Telegram сам отправляет header `X-Telegram-Bot-Api-Secret-Token`, если
 * webhook зарегистрирован с `secret_token` в `setWebhook`. Контроллер
 * сверяет его timing-safe c `Channel.config.webhookSecret`.
 *
 * Проверяем:
 *   - 404 channel_not_configured если Channel нет / неактивен.
 *   - 403 invalid_webhook_secret если header пустой / не совпал.
 *   - 200 happy path и вызов adapter.ingestUpdate + conversational.dispatchInbound.
 *   - 200 без 5xx если adapter.ingestUpdate бросает (логируем, возвращаем 200).
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { TelegramWebhooksController } from './telegram-webhooks.controller';

import type { PrismaService } from '../../../../common/prisma/prisma.service';
import type { ConversationalService } from '../../conversational.service';
import type { TelegramBotChannelAdapter } from './telegram-bot.adapter';

const SECRET = 'webhook-secret-42';

function build(opts: {
  channel?: { status: string } | null;
  readSecret?: string | null;
  adapterIngestReturns?: 'inbound' | 'null' | 'throw';
  dispatchThrows?: boolean;
} = {}) {
  const channel = opts.channel === undefined
    ? { status: 'active' }
    : opts.channel;
  const prisma = {
    channel: {
      findUnique: vi.fn(async () => channel),
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

  const ctrl = new TelegramWebhooksController(prisma, adapter, conversational);
  return { ctrl, prisma, adapter, conversational };
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

describe('TelegramWebhooksController', () => {
  it('happy: ingestUpdate + dispatchInbound вызываются, ok=true', async () => {
    const { ctrl, adapter, conversational } = build();
    const res = await ctrl.receive('tenant-1', validBody as never, SECRET);
    expect(res).toEqual({ ok: true });
    expect(adapter.ingestUpdate).toHaveBeenCalledOnce();
    expect(conversational.dispatchInbound).toHaveBeenCalledOnce();
  });

  it('404 channel_not_configured если Channel отсутствует', async () => {
    const { ctrl } = build({ channel: null });
    await expect(
      ctrl.receive('tenant-x', validBody as never, SECRET),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404 если канал неактивен (paused)', async () => {
    const { ctrl } = build({ channel: { status: 'paused' } });
    await expect(
      ctrl.receive('tenant-1', validBody as never, SECRET),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('403 invalid_webhook_secret если header отсутствует', async () => {
    const { ctrl } = build();
    await expect(
      ctrl.receive('tenant-1', validBody as never, undefined),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('403 invalid_webhook_secret если secret не совпадает', async () => {
    const { ctrl } = build();
    await expect(
      ctrl.receive('tenant-1', validBody as never, 'wrong-secret-padded-1234'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('403 webhook_secret_unreadable если расшифровка падает', async () => {
    const { ctrl } = build({ readSecret: null });
    await expect(
      ctrl.receive('tenant-1', validBody as never, SECRET),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('200 (НЕ 5xx) если adapter.ingestUpdate бросает', async () => {
    const { ctrl, conversational } = build({ adapterIngestReturns: 'throw' });
    const res = await ctrl.receive('tenant-1', validBody as never, SECRET);
    expect(res).toEqual({ ok: true });
    // dispatch НЕ вызывался — ingest упал.
    expect(conversational.dispatchInbound).not.toHaveBeenCalled();
  });

  it('200 если ingestUpdate вернул null (no-op event типа edit_message_reaction)', async () => {
    const { ctrl, conversational } = build({ adapterIngestReturns: 'null' });
    const res = await ctrl.receive('tenant-1', validBody as never, SECRET);
    expect(res).toEqual({ ok: true });
    expect(conversational.dispatchInbound).not.toHaveBeenCalled();
  });

  it('200 если dispatchInbound бросает (логируем, возвращаем 200, чтобы TG не ретраил)', async () => {
    const { ctrl } = build({ dispatchThrows: true });
    const res = await ctrl.receive('tenant-1', validBody as never, SECRET);
    expect(res).toEqual({ ok: true });
  });
});
