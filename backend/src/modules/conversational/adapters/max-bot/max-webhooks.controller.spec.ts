/**
 * Spec для MaxWebhooksController (Phase F.5).
 *
 * MAX Bot API (dev.max.ru/docs-api) НЕ передаёт header-secret. Secret валидация
 * — через path-параметр `/:tenantId/:secret`. URL сам по себе является
 * shared-secret. `setup-max-bot.ts` использует тот же формат.
 *
 * Покрытие:
 *   - 404 если Channel нет / неактивен.
 *   - 403 invalid_webhook_secret если secret в URL не совпал.
 *   - 200 happy: ingestUpdate + dispatchInbound.
 *   - 200 без 5xx если adapter / dispatch бросают.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { MaxWebhooksController } from './max-webhooks.controller';

import type { PrismaService } from '../../../../common/prisma/prisma.service';
import type { ConversationalService } from '../../conversational.service';
import type { MaxBotChannelAdapter } from './max-bot.adapter';

const SECRET = 'max-secret-shared-32characters!!';

function build(opts: {
  channel?: { status: string } | null;
  readSecret?: string | null;
  adapterIngestReturns?: 'inbound' | 'null' | 'throw';
  dispatchThrows?: boolean;
} = {}) {
  const channel =
    opts.channel === undefined ? { status: 'active' } : opts.channel;
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

  const ctrl = new MaxWebhooksController(prisma, adapter, conversational);
  return { ctrl, prisma, adapter, conversational };
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
    await expect(
      ctrl.receive('tenant-1', SECRET, validBody as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404 если канал неактивен', async () => {
    const { ctrl } = build({ channel: { status: 'disabled' } });
    await expect(
      ctrl.receive('tenant-1', SECRET, validBody as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('403 invalid_webhook_secret если secret в URL не совпал', async () => {
    const { ctrl } = build();
    await expect(
      ctrl.receive('tenant-1', 'wrong-secret-of-same-length-12345', validBody as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('403 webhook_secret_unreadable если расшифровка падает', async () => {
    const { ctrl } = build({ readSecret: null });
    await expect(
      ctrl.receive('tenant-1', SECRET, validBody as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
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
