import { type WebhookEvent } from 'livekit-server-sdk';
import type { Counter } from 'prom-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { PrismaService } from '../../common/prisma/prisma.service';

import type { LivekitEventsHandler } from './livekit-events.handler';
import type { LivekitSignatureVerifier } from './livekit-signature.verifier';
import { LivekitWebhooksService } from './livekit-webhooks.service';

/**
 * ТЗ-2 Фаза 3: ack-first обработка вебхуков за флагом
 * `LIVEKIT_WEBHOOK_ACK_FIRST_ENABLED` (дефолт OFF).
 *
 * Проверяем:
 *   (a) флаг OFF (дефолт) → eventsHandler.handle вызван (как раньше);
 *   (b) флаг ON → eventsHandler.handle тоже вызван (фоном, verify/dedup ДО);
 *   (c) невалидная подпись → throw НЕЗАВИСИМО от флага, handle НЕ вызван.
 */

interface MakeOpts {
  ackFirst: boolean;
  /** Если true — verifier.verify бросает (имитация невалидной подписи). */
  verifyThrows?: boolean;
}

function makeService(opts: MakeOpts): {
  service: LivekitWebhooksService;
  verifier: { verify: ReturnType<typeof vi.fn> };
  eventsHandler: { handle: ReturnType<typeof vi.fn> };
  seenCreate: ReturnType<typeof vi.fn>;
} {
  const event = { event: 'room_finished', id: 'evt-1', room: { name: 'm-1' } } as unknown as WebhookEvent;

  const verifier = {
    verify: vi.fn(() => {
      if (opts.verifyThrows) throw new Error('webhook_signature_invalid');
      return event;
    }),
  };

  const seenCreate = vi.fn(async () => ({ eventId: 'evt-1' }));
  const meetingFindUnique = vi.fn(async () => null); // нет встречи → MeetingEvent не пишем
  const prisma = {
    webhookSeenEvent: { create: seenCreate },
    meeting: { findUnique: meetingFindUnique },
    meetingEvent: { create: vi.fn() },
  } as unknown as PrismaService;

  const eventsTotal = {
    inc: vi.fn(),
  } as unknown as Counter<'type' | 'dedup'>;

  const eventsHandler = {
    handle: vi.fn(async () => undefined),
  };

  const cfg = {
    livekit: { webhookAckFirstEnabled: opts.ackFirst },
  } as unknown as TypedConfigService;

  const service = new LivekitWebhooksService(
    verifier as unknown as LivekitSignatureVerifier,
    prisma,
    eventsTotal,
    eventsHandler as unknown as LivekitEventsHandler,
    cfg,
  );

  return { service, verifier, eventsHandler, seenCreate };
}

describe('LivekitWebhooksService — ack-first флаг', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('(a) флаг OFF (дефолт) → eventsHandler.handle вызван синхронно', async () => {
    const { service, eventsHandler } = makeService({ ackFirst: false });
    await service.handle(Buffer.from('{}'), 'auth');
    expect(eventsHandler.handle).toHaveBeenCalledTimes(1);
  });

  it('(b) флаг ON → eventsHandler.handle вызван (фоном), verify+dedup отработали ДО', async () => {
    const { service, verifier, eventsHandler, seenCreate } = makeService({ ackFirst: true });
    await service.handle(Buffer.from('{}'), 'auth');
    // verify и дедуп — синхронны и выполнены до фоновой обработки.
    expect(verifier.verify).toHaveBeenCalledTimes(1);
    expect(seenCreate).toHaveBeenCalledTimes(1);
    // handle всё равно вызван (в фоне, но синхронно стартует в той же микротаске).
    expect(eventsHandler.handle).toHaveBeenCalledTimes(1);
  });

  it('(c) невалидная подпись → throw + eventsHandler.handle НЕ вызван (флаг OFF)', async () => {
    const { service, eventsHandler, seenCreate } = makeService({
      ackFirst: false,
      verifyThrows: true,
    });
    await expect(service.handle(Buffer.from('{}'), 'auth')).rejects.toThrow();
    expect(seenCreate).not.toHaveBeenCalled();
    expect(eventsHandler.handle).not.toHaveBeenCalled();
  });

  it('(c) невалидная подпись → throw + eventsHandler.handle НЕ вызван (флаг ON)', async () => {
    const { service, eventsHandler, seenCreate } = makeService({
      ackFirst: true,
      verifyThrows: true,
    });
    await expect(service.handle(Buffer.from('{}'), 'auth')).rejects.toThrow();
    expect(seenCreate).not.toHaveBeenCalled();
    expect(eventsHandler.handle).not.toHaveBeenCalled();
  });
});
