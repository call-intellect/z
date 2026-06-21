import type { Notification, ProbeEvent } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { LlmRouterService } from '../ai/services/llm-router.service';
import type { ConversationalIngestAdapter } from '../conversational/adapters/conversational-ingest.adapter';
import type { ConversationalService } from '../conversational/conversational.service';
import type { CurationService } from '../curation/services/curation.service';

import { ProbeResponseHandler } from './probe-response.handler';
import type { NotificationRespondedPayload } from './probe.types';

function buildProbe(): ProbeEvent {
  return {
    id: 'probe-classify-1',
    tenantId: 'org-classify',
    emittedByService: '3-3-decisions',
    reason: 'decision.confirm_status',
    payload: {
      question: 'Решение по миграции на DeepSeek принято?',
      message: 'Нужно подтверждение статуса по миграции на DeepSeek.',
    },
    recipientCandidates: ['user-1'],
    selectedRecipientId: 'user-1',
    status: 'dispatched',
    dispatchedNotificationId: 'notif-classify-1',
    contentHash: 'h',
    priority: 50,
    createdAt: new Date(Date.now() - 60_000),
    dispatchedAt: new Date(Date.now() - 30_000),
    expiresAt: null,
  } as unknown as ProbeEvent;
}

function buildNotification(): Notification {
  return {
    id: 'notif-classify-1',
    tenantId: 'org-classify',
    recipientUserId: 'user-1',
    eventType: 'probe.question',
    payload: { question: 'Решение принято?' },
    status: 'responded',
  } as unknown as Notification;
}

interface Mocks {
  prisma: PrismaService;
  metrics: BusinessMetricsService;
  ingestAdapter: ConversationalIngestAdapter;
  ingestArgs: Array<Record<string, unknown>>;
  llmCall: ReturnType<typeof vi.fn>;
  curationFindFirst: ReturnType<typeof vi.fn>;
  curationDecide: ReturnType<typeof vi.fn>;
}

function makeMocks(): Mocks {
  const probe = buildProbe();
  const notif = buildNotification();
  const ingestArgs: Array<Record<string, unknown>> = [];

  const curationFindFirst = vi
    .fn()
    .mockResolvedValue({ id: 'curation-item-1' });
  const curationDecide = vi.fn().mockResolvedValue({ id: 'curation-item-1' });

  const prisma = {
    probeEvent: {
      findFirst: vi.fn().mockResolvedValue(probe),
    },
    notification: {
      findUnique: vi.fn().mockResolvedValue(notif),
    },
    notificationDelivery: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'd',
        notificationId: 'notif-classify-1',
        channelBinding: { channel: { kind: 'telegram_bot' } },
      }),
    },
    curationItem: {
      findFirst: curationFindFirst,
    },
  } as unknown as PrismaService;

  const metrics = {
    incProbeResponse: vi.fn(),
    observeProbeResponseTime: vi.fn(),
    incProbeClosed: vi.fn(),
    incProbeResponseClassified: vi.fn(),
    incProbeResponseUnclear: vi.fn(),
    incProbeOutcome: vi.fn(),
  } as unknown as BusinessMetricsService;

  const ingestAdapter = {
    ingestNotificationResponse: vi.fn().mockImplementation(async (args) => {
      ingestArgs.push(args as Record<string, unknown>);
      return {};
    }),
  } as unknown as ConversationalIngestAdapter;

  const llmCall = vi.fn();

  return {
    prisma,
    metrics,
    ingestAdapter,
    ingestArgs,
    llmCall,
    curationFindFirst,
    curationDecide,
  };
}

function makeHandler(args: {
  mocks: Mocks;
  classifyEnabled: boolean;
  minConfidence?: number;
}): ProbeResponseHandler {
  const llm = { call: args.mocks.llmCall } as unknown as LlmRouterService;
  const cfg = {
    probe: {
      responseClassifyEnabled: args.classifyEnabled,
      voiceInputEnabled: true,
      responseClassifyMinConfidence: args.minConfidence ?? 0.5,
    },
  } as unknown as TypedConfigService;
  const conversational = {
    sendNotification: vi.fn().mockResolvedValue({ id: 'ack-notif-1' }),
  } as unknown as ConversationalService;
  const curation = {
    decide: args.mocks.curationDecide,
  } as unknown as CurationService;
  return new ProbeResponseHandler(
    args.mocks.prisma,
    args.mocks.metrics,
    args.mocks.ingestAdapter,
    llm,
    cfg,
    conversational,
    curation,
  );
}

const event: NotificationRespondedPayload = {
  tenantId: 'org-classify',
  notificationId: 'notif-classify-1',
  recipientUserId: 'user-1',
  eventType: 'probe.question',
  payload: { text: 'Да, согласовано, начинаем в понедельник' },
  contextBlockId: null,
  contextCardId: null,
};

describe('ProbeResponseHandler — Agents v2 Фаза 0.1 classifier', () => {
  let mocks: Mocks;

  beforeEach(() => {
    mocks = makeMocks();
  });

  it('high confidence (0.9) — parsedAnswer/parsedConfidence в payload, bucket=high', async () => {
    mocks.llmCall.mockResolvedValueOnce({
      text: JSON.stringify({
        answer: 'Да, согласовано',
        confidence: 0.9,
        requiresFollowup: false,
      }),
    });

    const handler = makeHandler({ mocks, classifyEnabled: true });
    await handler.handle(event);

    expect(mocks.llmCall).toHaveBeenCalledTimes(1);
    expect(mocks.metrics.incProbeResponseClassified).toHaveBeenCalledWith({
      confidence_bucket: 'high',
    });
    expect(mocks.metrics.incProbeResponseUnclear).not.toHaveBeenCalled();
    expect(mocks.ingestArgs).toHaveLength(1);
    const ingested = mocks.ingestArgs[0]!;
    const payload = ingested.payload as Record<string, unknown>;
    expect(payload.parsedAnswer).toBe('Да, согласовано');
    expect(payload.parsedConfidence).toBe(0.9);
    expect(payload.notification_response_unclear).toBeUndefined();
  });

  it('low confidence (0.3) — bucket=low + unclear, payload помечен, closing-loop НЕ блокируется', async () => {
    mocks.llmCall.mockResolvedValueOnce({
      text: JSON.stringify({
        answer: 'непонятно',
        confidence: 0.3,
        requiresFollowup: true,
      }),
    });

    const handler = makeHandler({ mocks, classifyEnabled: true });
    await handler.handle(event);

    expect(mocks.metrics.incProbeResponseClassified).toHaveBeenCalledWith({
      confidence_bucket: 'low',
    });
    expect(mocks.metrics.incProbeResponseUnclear).toHaveBeenCalledWith({
      originalReason: 'decision.confirm_status',
    });
    expect(mocks.ingestArgs).toHaveLength(1);
    const payload = mocks.ingestArgs[0]!.payload as Record<string, unknown>;
    expect(payload.notification_response_unclear).toBe(true);
    expect(payload.parsedConfidence).toBe(0.3);
    expect(mocks.metrics.incProbeClosed).toHaveBeenCalled();
  });

  it('LLM throw — handler не падает, classify-метрики НЕ дёрнуты, ingest БЕЗ parsedAnswer', async () => {
    mocks.llmCall.mockRejectedValueOnce(new Error('llm proxy 500'));

    const handler = makeHandler({ mocks, classifyEnabled: true });
    await handler.handle(event);

    expect(mocks.metrics.incProbeResponseClassified).not.toHaveBeenCalled();
    expect(mocks.metrics.incProbeResponseUnclear).not.toHaveBeenCalled();
    expect(mocks.ingestArgs).toHaveLength(1);
    const payload = mocks.ingestArgs[0]!.payload as Record<string, unknown>;
    expect(payload.parsedAnswer).toBeUndefined();
    expect(payload.parsedConfidence).toBeUndefined();
    expect(payload.notification_response_unclear).toBeUndefined();
    expect(mocks.metrics.incProbeClosed).toHaveBeenCalled();
  });

  it('PROBE_RESPONSE_CLASSIFY_ENABLED=false — LLM не вызывается, ingest без parsing', async () => {
    const handler = makeHandler({ mocks, classifyEnabled: false });
    await handler.handle(event);

    expect(mocks.llmCall).not.toHaveBeenCalled();
    expect(mocks.metrics.incProbeResponseClassified).not.toHaveBeenCalled();
    expect(mocks.ingestArgs).toHaveLength(1);
    const payload = mocks.ingestArgs[0]!.payload as Record<string, unknown>;
    expect(payload.parsedAnswer).toBeUndefined();
  });

  it('payload.formulatedQuestion — приоритет над reason/message при сборке question для LLM', async () => {
    const probeWithFormulated = {
      ...buildProbe(),
      payload: {
        formulatedQuestion: 'Вы согласовали с финдиректором?',
        question: 'устаревший legacy ключ',
        message: 'контекст от specialist, не сам вопрос',
      },
      reason: 'decision.confirm_status_machine_code',
    };
    (mocks.prisma.probeEvent.findFirst as ReturnType<typeof vi.fn>) = vi
      .fn()
      .mockResolvedValue(probeWithFormulated);

    mocks.llmCall.mockResolvedValueOnce({
      text: JSON.stringify({
        answer: 'Да',
        confidence: 0.9,
        requiresFollowup: false,
      }),
    });

    const handler = makeHandler({ mocks, classifyEnabled: true });
    await handler.handle(event);

    expect(mocks.llmCall).toHaveBeenCalledTimes(1);
    const llmArgs = mocks.llmCall.mock.calls[0]![0] as {
      userMessage: string;
    };
    expect(llmArgs.userMessage).toContain('Вы согласовали с финдиректором?');
    expect(llmArgs.userMessage).not.toContain('decision.confirm_status_machine_code');
    expect(llmArgs.userMessage).not.toContain('устаревший legacy ключ');
    expect(llmArgs.userMessage).not.toContain('контекст от specialist, не сам вопрос');
  });

  it('reason=skill.cdm_interview → ingest получает signalTypeHint=reasoning и questionText (каскад formulatedQuestion)', async () => {
    const probeCdm = {
      ...buildProbe(),
      reason: 'skill.cdm_interview',
      payload: {
        formulatedQuestion: 'Какие альтернативы вы рассматривали и почему отвергли?',
        suggestedQuestion: 'fallback-вопрос специалиста',
        message: 'контекст кейса',
      },
    };
    (mocks.prisma.probeEvent.findFirst as ReturnType<typeof vi.fn>) = vi
      .fn()
      .mockResolvedValue(probeCdm);
    mocks.llmCall.mockResolvedValueOnce({
      text: JSON.stringify({
        answer: 'Рассматривал выкат в пятницу',
        confidence: 0.9,
        requiresFollowup: false,
      }),
    });

    const handler = makeHandler({ mocks, classifyEnabled: true });
    await handler.handle(event);

    expect(mocks.ingestArgs).toHaveLength(1);
    const ingested = mocks.ingestArgs[0]!;
    expect(ingested.signalTypeHint).toBe('reasoning');
    expect(ingested.questionText).toBe('Какие альтернативы вы рассматривали и почему отвергли?');
  });

  it('обычный reason → signalTypeHint НЕ передаётся (undefined), questionText из каскада есть', async () => {
    mocks.llmCall.mockResolvedValueOnce({
      text: JSON.stringify({
        answer: 'Да',
        confidence: 0.9,
        requiresFollowup: false,
      }),
    });

    const handler = makeHandler({ mocks, classifyEnabled: true });
    await handler.handle(event);

    expect(mocks.ingestArgs).toHaveLength(1);
    const ingested = mocks.ingestArgs[0]!;
    expect(ingested.signalTypeHint).toBeUndefined();
    expect(ingested.questionText).toBe('Решение по миграции на DeepSeek принято?');
  });
});

describe('ProbeResponseHandler — existence-confirm → curation.decide', () => {
  function setExistenceConfirmProbe(mocks: Mocks): void {
    (mocks.prisma.probeEvent.findFirst as ReturnType<typeof vi.fn>) = vi
      .fn()
      .mockResolvedValue({
        ...buildProbe(),
        reason: 'regulation.existence_confirm',
        payload: {
          message:
            'Кора зафиксировала регламент «Возвраты». Оставить, переименовать или удалить?',
          contextCardId: 'reg-99',
          contextCardKind: 'regulation',
        },
      });
  }

  it('ответ «Удалить» (classifier off) → decide(reject) по существующему pending CurationItem', async () => {
    const mocks = makeMocks();
    setExistenceConfirmProbe(mocks);
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({
      ...event,
      payload: { text: 'Удалить, это устарело' },
    });

    expect(mocks.curationFindFirst).toHaveBeenCalledTimes(1);
    const where = mocks.curationFindFirst.mock.calls[0]![0] as {
      where: { tenantId: string; resourceId: string; status: string };
    };
    expect(where.where).toMatchObject({
      tenantId: 'org-classify',
      resourceId: 'reg-99',
      status: 'pending',
    });
    expect(mocks.curationDecide).toHaveBeenCalledTimes(1);
    const decideArg = mocks.curationDecide.mock.calls[0]![0] as {
      tenantId: string;
      curationItemId: string;
      reviewerUserId: string;
      decisionType: string;
    };
    expect(decideArg).toMatchObject({
      tenantId: 'org-classify',
      curationItemId: 'curation-item-1',
      reviewerUserId: 'user-1',
      decisionType: 'reject',
    });
  });

  it('ответ «Переименовать» → decide(approve_with_edits)', async () => {
    const mocks = makeMocks();
    setExistenceConfirmProbe(mocks);
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({
      ...event,
      payload: { text: 'Переименовать в «Политика возвратов»' },
    });

    expect(mocks.curationDecide).toHaveBeenCalledTimes(1);
    const decideArg = mocks.curationDecide.mock.calls[0]![0] as {
      decisionType: string;
    };
    expect(decideArg.decisionType).toBe('approve_with_edits');
  });

  it('нераспознанный ответ → curation НЕ трогается', async () => {
    const mocks = makeMocks();
    setExistenceConfirmProbe(mocks);
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({
      ...event,
      payload: { text: 'хм не уверен' },
    });

    expect(mocks.curationFindFirst).not.toHaveBeenCalled();
    expect(mocks.curationDecide).not.toHaveBeenCalled();
  });

  it('pending CurationItem не найден → decide НЕ вызывается (best-effort no-op)', async () => {
    const mocks = makeMocks();
    setExistenceConfirmProbe(mocks);
    mocks.curationFindFirst.mockResolvedValueOnce(null);
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({
      ...event,
      payload: { text: 'Удалить' },
    });

    expect(mocks.curationFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.curationDecide).not.toHaveBeenCalled();
  });

  it('обычный probe (не existence_confirm) → curation не трогается', async () => {
    const mocks = makeMocks();
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({
      ...event,
      payload: { text: 'Удалить' },
    });

    expect(mocks.curationFindFirst).not.toHaveBeenCalled();
    expect(mocks.curationDecide).not.toHaveBeenCalled();
  });
});
