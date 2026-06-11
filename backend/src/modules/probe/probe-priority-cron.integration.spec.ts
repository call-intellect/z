/**
 * SBA β-5 closing-loop (sub-TZ 2026-05-23) — integration-тест для
 * `ProbeResponseHandler` + `ProbePriorityCron`.
 *
 * Сценарий DoD §15:
 *   1. Есть ProbeEvent (status='pending', dispatchedNotificationId=N).
 *   2. Пользователь ответил → Notification.respondedAt стал задан.
 *      ProbeResponseHandler.handle(...) вызывается с probe-eventType:
 *        - инкрементит probe_response_total / probe_closed_total;
 *        - создаёт RawEvent через ConversationalIngestAdapter (kind=
 *          'notification_response').
 *   3. expiresAt < now → cron запускается.
 *   4. Probe НЕ должен попасть в expired (т.к. respondedAt IS NOT NULL).
 *
 * "Интеграция" — в смысле "ProbeResponseHandler + ConversationalIngestAdapter
 * + ProbePriorityCron работают вместе через DI, реальная БД не используется".
 * Все Prisma-методы мокированы.
 */

import type { Notification, ProbeEvent, RawEvent } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { LlmRouterService } from '../ai/services/llm-router.service';
import { ConversationalIngestAdapter } from '../conversational/adapters/conversational-ingest.adapter';
import type { IngestService } from '../ingest/ingest.service';

import { ProbePriorityCron } from './probe-priority.cron';
import { ProbeResponseHandler } from './probe-response.handler';
import type { NotificationRespondedPayload } from './probe.types';

function nowMinus(hours: number): Date {
  return new Date(Date.now() - hours * 3600 * 1000);
}

interface ScenarioState {
  probe: ProbeEvent;
  notification: Notification;
}

function buildScenario(): ScenarioState {
  const probe: ProbeEvent = {
    id: 'probe-1',
    tenantId: 'org-1',
    emittedByService: '3-3-decisions',
    reason: 'decision.overdue',
    payload: {},
    recipientCandidates: ['user-1'],
    selectedRecipientId: 'user-1',
    status: 'pending',
    dispatchedNotificationId: 'notif-1',
    contentHash: 'hash-1',
    priority: 50,
    createdAt: nowMinus(48),
    dispatchedAt: nowMinus(40),
    expiresAt: nowMinus(1), // уже истёк
  } as unknown as ProbeEvent;

  const notification: Notification = {
    id: 'notif-1',
    tenantId: 'org-1',
    recipientUserId: 'user-1',
    eventType: 'probe.question',
    payload: { question: 'Решение принято?' },
    dataClass: 'internal',
    contextBlockId: null,
    contextCardId: null,
    status: 'responded',
    responseStatus: 'answered',
    responsePayload: { choice: 'Да' },
    expiresAt: null,
    createdAt: nowMinus(40),
    respondedAt: new Date(), // ← ключ closing-loop
  } as unknown as Notification;

  return { probe, notification };
}

describe('SBA β-5 closing-loop — ProbeResponseHandler + ProbePriorityCron', () => {
  let state: ScenarioState;
  let prisma: PrismaService;
  let metrics: BusinessMetricsService;
  let ingestSvc: IngestService;
  let ingestAdapter: ConversationalIngestAdapter;
  let createdRawEvent: RawEvent | null;

  beforeEach(() => {
    state = buildScenario();
    createdRawEvent = null;

    ingestSvc = {
      ingest: vi.fn().mockImplementation(async (input: unknown) => {
        const i = input as {
          tenantId: string;
          sourceId: string;
          sourceExternalId: string | null;
          payload: Record<string, unknown>;
        };
        createdRawEvent = {
          id: 'raw-resp-1',
          tenantId: i.tenantId,
          sourceId: i.sourceId,
          sourceType: 'conversational',
          sourceExternalId: i.sourceExternalId,
          idempotencyKey: 'ik',
          occurredAt: new Date(),
          receivedAt: new Date(),
          payloadStorage: 'inline',
          payload: i.payload,
          payloadS3Key: null,
          payloadChecksum: 'sha',
          payloadSizeBytes: JSON.stringify(i.payload).length,
          dataClass: 'internal',
          processingStatus: 'received',
          processingError: null,
          processedAt: null,
        } as unknown as RawEvent;
        return { rawEvent: createdRawEvent, idempotent: false };
      }),
    } as unknown as IngestService;

    prisma = {
      source: {
        upsert: vi.fn().mockResolvedValue({
          id: 'src-conv-1',
          tenantId: 'org-1',
          type: 'conversational',
          name: ConversationalIngestAdapter.DEFAULT_SOURCE_NAME,
          dataClass: 'internal',
          isActive: true,
        }),
      },
      probeEvent: {
        findFirst: vi.fn().mockImplementation(async () => state.probe),
        findMany: vi.fn().mockImplementation(async () => [
          {
            id: state.probe.id,
            dispatchedNotificationId: state.probe.dispatchedNotificationId,
          },
        ]),
        updateMany: vi
          .fn()
          .mockImplementation(async (args: { where: { id: { in: string[] } } }) => {
            if (args.where.id.in.includes(state.probe.id)) {
              state.probe.status = 'expired';
              return { count: 1 };
            }
            return { count: 0 };
          }),
      },
      notification: {
        findUnique: vi.fn().mockImplementation(async () => state.notification),
        groupBy: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
      notificationDelivery: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'd-1',
          notificationId: 'notif-1',
          channelBinding: { channel: { kind: 'in_app' } },
        }),
      },
    } as unknown as PrismaService;

    metrics = {
      incProbeResponse: vi.fn(),
      observeProbeResponseTime: vi.fn(),
      incProbeClosed: vi.fn(),
      incProbeExpired: vi.fn(),
      setProbeRecipientEngagementRate: vi.fn(),
      incProbeResponseClassified: vi.fn(),
      incProbeResponseUnclear: vi.fn(),
      incProbeOutcome: vi.fn(),
    } as unknown as BusinessMetricsService;

    ingestAdapter = new ConversationalIngestAdapter(prisma, ingestSvc);
  });

  // Probe Фаза 5 — ProbePriorityCron теперь пишет engagement-снимок и cooldown
  // темы в Redis + читает probe.topicCooldownHours; мокаем оба зависимостями.
  const redisMock = {
    client: { set: vi.fn().mockResolvedValue('OK') },
  } as unknown as import('../../common/redis/redis.service').RedisService;
  const cfgMock = {
    getDynamic: vi.fn().mockResolvedValue(48),
  } as unknown as TypedConfigService;

  // Agents v2 Фаза 0.1: handler теперь требует LlmRouter + TypedConfig.
  // Здесь classify по умолчанию выключаем (responseClassifyEnabled=false),
  // чтобы старые сценарии работали как раньше.
  function buildHandler(args?: {
    classifyEnabled?: boolean;
    minConfidence?: number;
    llmResult?: { text: string };
    llmThrow?: boolean;
  }): ProbeResponseHandler {
    const llm = {
      call: vi.fn().mockImplementation(async () => {
        if (args?.llmThrow) throw new Error('llm down');
        return args?.llmResult ?? { text: '{"answer":"","confidence":0,"requiresFollowup":true}' };
      }),
    } as unknown as LlmRouterService;
    const cfg = {
      probe: {
        responseClassifyEnabled: args?.classifyEnabled ?? false,
        voiceInputEnabled: true,
        responseClassifyMinConfidence: args?.minConfidence ?? 0.5,
      },
    } as unknown as TypedConfigService;
    return new ProbeResponseHandler(prisma, metrics, ingestAdapter, llm, cfg);
  }

  it('handler: notification.responded для probe.* → создаёт RawEvent и инкрементит probe_closed_total', async () => {
    const handler = buildHandler();
    const event: NotificationRespondedPayload = {
      tenantId: 'org-1',
      notificationId: 'notif-1',
      recipientUserId: 'user-1',
      eventType: 'probe.question',
      payload: { choice: 'Да' },
      contextBlockId: null,
      contextCardId: null,
    };

    await handler.handle(event);

    // Метрики
    expect(metrics.incProbeResponse).toHaveBeenCalledWith({
      eventType: 'probe.question',
      kind: 'in_app',
    });
    expect(metrics.incProbeClosed).toHaveBeenCalledWith({
      tenantTop: 'org-1'.slice(0, 8),
      source: 'in_app',
    });

    // RawEvent создан
    expect(ingestSvc.ingest).toHaveBeenCalledTimes(1);
    expect(createdRawEvent).not.toBeNull();
    expect(createdRawEvent!.sourceExternalId).toBe('resp:notif-1');
    const payload = createdRawEvent!.payload as Record<string, unknown>;
    expect(payload.kind).toBe('notification_response');
    expect(payload.respondsToNotificationId).toBe('notif-1');
    expect(payload.eventType).toBe('probe.question');
    expect(payload.sourceChannelKind).toBe('in_app');
  });

  it('handler: notification.responded для НЕ probe.* — no-op (нет RawEvent / нет probe_closed_total)', async () => {
    const handler = buildHandler();
    const event: NotificationRespondedPayload = {
      tenantId: 'org-1',
      notificationId: 'notif-other',
      recipientUserId: 'user-1',
      eventType: 'curation.pending',
      payload: {},
      contextBlockId: null,
      contextCardId: null,
    };

    await handler.handle(event);

    expect(ingestSvc.ingest).not.toHaveBeenCalled();
    expect(metrics.incProbeClosed).not.toHaveBeenCalled();
    expect(metrics.incProbeResponse).not.toHaveBeenCalled();
  });

  it('cron: respondedAt IS NOT NULL → probe НЕ помечается expired', async () => {
    // Notification.respondedAt уже задан в scenario (закрыт пользователем).
    const cron = new ProbePriorityCron(prisma, metrics, redisMock, cfgMock);

    await cron.sweep();

    // updateMany по expired НЕ должен звать (т.к. кандидат отфильтрован).
    expect(prisma.probeEvent.updateMany).not.toHaveBeenCalled();
    expect(metrics.incProbeExpired).not.toHaveBeenCalled();
    expect(state.probe.status).toBe('pending');
  });

  it('cron: respondedAt IS NULL → probe помечается expired (метрика incProbeExpired)', async () => {
    // Снимаем «ответ» — имитируем случай, когда пользователь так и не ответил.
    state.notification.respondedAt = null;

    const cron = new ProbePriorityCron(prisma, metrics, redisMock, cfgMock);
    await cron.sweep();

    expect(prisma.probeEvent.updateMany).toHaveBeenCalledTimes(1);
    expect(metrics.incProbeExpired).toHaveBeenCalledTimes(1);
    expect(state.probe.status).toBe('expired');
  });
});
