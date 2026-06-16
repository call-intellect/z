import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { LlmRouterService } from '../ai/services/llm-router.service';
import type { ConversationalIngestAdapter } from '../conversational/adapters/conversational-ingest.adapter';
import type { ConversationalService } from '../conversational/conversational.service';

import { ProbeResponseHandler } from './probe-response.handler';
import type { NotificationRespondedPayload } from './probe.types';

function build(args: { ackThrows?: boolean; title?: string }): {
  handler: ProbeResponseHandler;
  sendNotification: ReturnType<typeof vi.fn>;
  ingest: ReturnType<typeof vi.fn>;
} {
  const probe = {
    id: 'probe-ack-1',
    tenantId: 'org-1',
    reason: 'decision.overdue',
    dispatchedAt: new Date(Date.now() - 1000),
    payload: {
      ...(args.title ? { contextCardTitle: args.title } : {}),
      dataClass: 'internal',
    },
  };
  const ingest = vi.fn().mockResolvedValue(undefined);
  const prisma = {
    probeEvent: { findFirst: vi.fn().mockResolvedValue(probe) },
    notificationDelivery: {
      findFirst: vi.fn().mockResolvedValue({
        channelBinding: { channel: { kind: 'telegram_bot' } },
      }),
    },
    notification: { findUnique: vi.fn().mockResolvedValue(null) },
  } as unknown as PrismaService;

  const metrics = {
    incProbeResponse: vi.fn(),
    observeProbeResponseTime: vi.fn(),
    incProbeClosed: vi.fn(),
    incProbeOutcome: vi.fn(),
    incProbeResponseClassified: vi.fn(),
    incProbeResponseUnclear: vi.fn(),
  } as unknown as BusinessMetricsService;

  const ingestAdapter = {
    ingestNotificationResponse: ingest,
  } as unknown as ConversationalIngestAdapter;

  const llm = { call: vi.fn() } as unknown as LlmRouterService;
  const cfg = {
    probe: {
      responseClassifyEnabled: false,
      voiceInputEnabled: true,
      responseClassifyMinConfidence: 0.5,
    },
  } as unknown as TypedConfigService;

  const sendNotification = vi.fn().mockImplementation(async () => {
    if (args.ackThrows) throw new Error('send fail');
    return { id: 'ack-1' };
  });
  const conversational = {
    sendNotification,
  } as unknown as ConversationalService;

  const handler = new ProbeResponseHandler(
    prisma,
    metrics,
    ingestAdapter,
    llm,
    cfg,
    conversational,
  );
  return { handler, sendNotification, ingest };
}

const event: NotificationRespondedPayload = {
  tenantId: 'org-1',
  notificationId: 'notif-1',
  recipientUserId: 'user-1',
  eventType: 'probe.question',
  payload: { text: 'Готово, перешли' },
  contextBlockId: null,
  contextCardId: null,
};

describe('ProbeResponseHandler — видимое следствие (Фаза 6)', () => {
  it('после ответа шлёт probe.answer_acknowledged с названием объекта', async () => {
    const env = build({ title: 'Новый подрядчик' });
    await env.handler.handle(event);

    expect(env.sendNotification).toHaveBeenCalledTimes(1);
    const arg = env.sendNotification.mock.calls[0]![0] as {
      eventType: string;
      recipientUserId: string;
      payload: { text: string; objectTitle?: string };
    };
    expect(arg.eventType).toBe('probe.answer_acknowledged');
    expect(arg.recipientUserId).toBe('user-1');
    expect(arg.payload.text).toContain('память компании');
    expect(arg.payload.text).toContain('Новый подрядчик');
    expect(arg.payload.objectTitle).toBe('Новый подрядчик');
  });

  it('текст подтверждения без латиницы/кодов', async () => {
    const env = build({ title: 'Склад на Мира' });
    await env.handler.handle(event);
    const arg = env.sendNotification.mock.calls[0]![0] as {
      payload: { text: string };
    };
    expect(/[A-Za-z]/.test(arg.payload.text)).toBe(false);
  });

  it('без объекта — подтверждение всё равно отправляется', async () => {
    const env = build({});
    await env.handler.handle(event);
    expect(env.sendNotification).toHaveBeenCalledTimes(1);
    const arg = env.sendNotification.mock.calls[0]![0] as {
      payload: { text: string; objectTitle?: string };
    };
    expect(arg.payload.text).toContain('память компании');
    expect(arg.payload.objectTitle).toBeUndefined();
  });

  it('ошибка ack не валит closing-loop (RawEvent всё равно создан)', async () => {
    const env = build({ title: 'X', ackThrows: true });
    await env.handler.handle(event);
    expect(env.ingest).toHaveBeenCalledTimes(1);
  });
});
