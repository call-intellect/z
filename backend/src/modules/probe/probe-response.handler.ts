import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { type DataClass } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LlmRouterService } from '../ai/services/llm-router.service';
import { applyInputGuards } from '../ai/services/prompts/common';
import { ConversationalIngestAdapter } from '../conversational/adapters/conversational-ingest.adapter';
import { ConversationalService } from '../conversational/conversational.service';

import type { NotificationRespondedPayload } from './probe.types';
import {
  PROBE_RESPONSE_CLASSIFY_JSON_SCHEMA,
  PROBE_RESPONSE_CLASSIFY_SCHEMA_NAME,
  PROBE_RESPONSE_CLASSIFY_SYSTEM_PROMPT,
  PROBE_RESPONSE_CLASSIFY_USER_TEMPLATE,
} from './prompts/probe-response-classify.prompt';

/**
 * SBA β-5 — обработчик `notification.responded`.
 *
 * Слушает события `notification.responded`, эмиттированные
 * `ConversationalService.respondToProbe`. Если eventType начинается с
 * 'probe.' — обновляет соответствующий `ProbeEvent.dispatchedAt` /
 * responded-state (через метрики) и эмитит business-метрики
 * `probe_response_total`, `probe_response_time_seconds`.
 *
 * SBA β-5 closing-loop (sub-TZ 2026-05-23) — дополнительно создаёт
 * `RawEvent(kind='notification_response')` через `ConversationalIngestAdapter`,
 * чтобы ответ пользователя попал обратно в knowledge-core pipeline.
 * Связь с исходной `Notification` — через `payload.respondsToNotificationId`.
 *
 * Agents v2 Фаза 0.1 (2026-05-30) — Probe-Response-Classify:
 *   - Если `PROBE_RESPONSE_CLASSIFY_ENABLED=true` (default) и в payload
 *     есть свободный текст ответа — зовём LLM-классификатор
 *     `probe-response-classify` (см. `prompts/probe-response-classify.prompt.ts`).
 *   - При `confidence >= cfg.probe.responseClassifyMinConfidence` — пишем
 *     `parsedAnswer`/`parsedConfidence` в payload ingest'а.
 *   - При confidence ниже порога — помечаем `notification_response_unclear:true`,
 *     эмитим `probe_response_unclear_total` + bucket=low. Closing-loop
 *     ВСЁ РАВНО выполняется (не теряем сырой ответ).
 *   - LLM-провал — пропускаем шаг классификации (старое поведение).
 */
@Injectable()
export class ProbeResponseHandler {
  private readonly logger = new Logger(ProbeResponseHandler.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(ConversationalIngestAdapter)
    private readonly ingestAdapter: ConversationalIngestAdapter,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
  ) {}

  @OnEvent('notification.responded')
  async handle(event: NotificationRespondedPayload): Promise<void> {
    try {
      if (!event.eventType.startsWith('probe.')) return;
      // Найдём probe.id по dispatchedNotificationId.
      const probe = await this.prisma.probeEvent.findFirst({
        where: {
          tenantId: event.tenantId,
          dispatchedNotificationId: event.notificationId,
        },
      });
      if (!probe) return;
      const kind = await this.lookupDeliveryKind(event.notificationId);

      this.metrics.incProbeResponse({
        eventType: event.eventType,
        kind: kind ?? 'unknown',
      });
      if (probe.dispatchedAt) {
        const sec = (Date.now() - probe.dispatchedAt.getTime()) / 1000;
        this.metrics.observeProbeResponseTime({
          eventType: event.eventType,
          kind: kind ?? 'unknown',
          seconds: sec,
        });
      }

      // ── Agents v2 Фаза 0.1 — классификация свободного ответа ─────
      // Сначала пробуем разобрать свободный текст ответа из payload.
      // Если есть question + response — зовём LLM. Иначе пропускаем.
      const probePayload = (probe.payload ?? {}) as Record<string, unknown>;
      const classification = await this.tryClassifyResponse({
        eventPayload: event.payload,
        probePayload,
        tenantId: event.tenantId,
        probeId: probe.id,
        probeReason: probe.reason,
      });

      // ── closing-loop: RawEvent + probe_closed_total ──────────────
      // Если классификация прошла — расширяем payload, не подменяя его.
      const ingestPayload: Record<string, unknown> = { ...event.payload };
      if (classification) {
        ingestPayload.parsedAnswer = classification.answer;
        ingestPayload.parsedConfidence = classification.confidence;
        if (classification.unclear) {
          ingestPayload.notification_response_unclear = true;
        }
      }

      await this.ingestResponseAsRawEvent({
        tenantId: event.tenantId,
        userId: event.recipientUserId,
        notificationId: event.notificationId,
        eventType: event.eventType,
        payload: ingestPayload,
        sourceChannelKind: kind,
        contextBlockId: event.contextBlockId,
        contextCardId: event.contextCardId,
      });
      this.metrics.incProbeClosed({
        tenantTop: this.normalizeTenantTop(event.tenantId),
        source: kind ?? 'unknown',
      });
      // Probe Фаза 5 (R10): человек ответил = исход «answered» (калибровочный
      // сигнал для Фазы 2, парный к «ignored» из priority-cron).
      this.metrics.incProbeOutcome({ outcome: 'answered', reason: probe.reason });

      // Probe Фаза 6 (R11): видимое следствие — подтверждение «ответ записан»
      // (+ название объекта). Не голосом (только текст). Best-effort: ошибка
      // подтверждения не валит уже завершённый closing-loop.
      await this.sendAnswerAck({
        tenantId: event.tenantId,
        recipientUserId: event.recipientUserId,
        probePayload,
        probeId: probe.id,
      });

      this.logger.log(
        `probe.responded: probeId=${probe.id} eventType=${event.eventType} kind=${kind ?? 'unknown'} classified=${classification ? `${classification.unclear ? 'unclear' : 'ok'}(${classification.confidence.toFixed(2)})` : 'skipped'} (closing-loop applied)`,
      );
    } catch (err) {
      this.logger.warn(
        {
          notificationId: event.notificationId,
          err: err instanceof Error ? err.message : String(err),
        },
        'ProbeResponseHandler: внутренняя ошибка — пропускаю',
      );
    }
  }

  /**
   * Probe Фаза 6 (R11) — видимое следствие ответа: отправить получателю
   * подтверждение «ваш ответ записан в память компании» + название объекта
   * (`contextCardTitle`). Только текст (НЕ голос). Best-effort: ошибка
   * подтверждения не валит уже завершённый closing-loop.
   */
  private async sendAnswerAck(args: {
    tenantId: string;
    recipientUserId: string;
    probePayload: Record<string, unknown>;
    probeId: string;
  }): Promise<void> {
    try {
      const title = this.toStringOrUndef(args.probePayload.contextCardTitle);
      const text = title
        ? `Спасибо! Ваш ответ записан в память компании. По теме «${title}».`
        : 'Спасибо! Ваш ответ записан в память компании.';
      await this.conversational.sendNotification({
        tenantId: args.tenantId,
        recipientUserId: args.recipientUserId,
        eventType: 'probe.answer_acknowledged',
        payload: {
          text,
          // summary — для рендера в кабинете (NotificationsClient) и каналах.
          summary: text,
          ...(title ? { objectTitle: title } : {}),
          probeEventId: args.probeId,
        },
        dataClass: this.extractDataClass(args.probePayload),
      });
    } catch (err) {
      this.logger.warn(
        {
          probeId: args.probeId,
          err: err instanceof Error ? err.message : String(err),
        },
        'ProbeResponseHandler: подтверждение ответа не отправлено — пропускаю',
      );
    }
  }

  /** dataClass из payload probe (как в dispatcher), дефолт internal. */
  private extractDataClass(payload: Record<string, unknown>): DataClass {
    const dc = payload.dataClass;
    if (
      dc === 'public' ||
      dc === 'internal' ||
      dc === 'sensitive' ||
      dc === 'private'
    ) {
      return dc;
    }
    return 'internal';
  }

  /**
   * Agents v2 Фаза 0.1 — классифицирует свободный ответ через
   * `probe-response-classify`. Возвращает `null`, если:
   *   - feature-flag выключен (`PROBE_RESPONSE_CLASSIFY_ENABLED=false`);
   *   - в payload нет ни текста ответа, ни вопроса (нечего классифицировать);
   *   - LLM упал (мы не блокируем closing-loop из-за этого).
   *
   * При `confidence < min` возвращает `{unclear: true}` и эмитит метрики
   * `probe_response_unclear_total` + `probe_response_classified_total{low}`.
   * При `confidence >= min` возвращает `{unclear: false}` и эмитит
   * `probe_response_classified_total{high|medium}`.
   */
  private async tryClassifyResponse(args: {
    eventPayload: Record<string, unknown>;
    probePayload: Record<string, unknown>;
    tenantId: string;
    probeId: string;
    probeReason: string;
  }): Promise<{
    answer: string;
    confidence: number;
    unclear: boolean;
  } | null> {
    if (!this.cfg.probe.responseClassifyEnabled) return null;

    const response = this.extractResponseText(args.eventPayload);
    if (!response) return null;

    // question — то, что задал probe-formulate. Приоритет:
    //   1. payload.formulatedQuestion — реально отправленный пользователю вопрос
    //      (его пишет ProbeDispatcherWorker после LLM probe-formulate; Agents v2 Фаза 0.2).
    //   2. payload.question — legacy ключ (на случай старых записей).
    //   3. payload.suggestedQuestion — fallback specialist'a (если LLM упал в dispatcher'е).
    //   4. payload.message — исходный текст от specialist'a.
    //   5. probe.reason — последний fallback (машинный код, плохо классифицируется).
    const question =
      this.toStringOrUndef(args.probePayload.formulatedQuestion) ??
      this.toStringOrUndef(args.probePayload.question) ??
      this.toStringOrUndef(args.probePayload.suggestedQuestion) ??
      this.toStringOrUndef(args.probePayload.message) ??
      args.probeReason;

    // A2: оборачиваем сырой пользовательский ввод (свободный ответ сотрудника
    // на probe + текст вопроса) в анти-инъекционные маркеры. asr не нужен
    // (это не транскрипт). Kill-switch — общий aiFeatures.promptInjectionGuardEnabled.
    const guardOn = this.cfg.aiFeatures?.promptInjectionGuardEnabled !== false;
    const guarded = applyInputGuards(
      PROBE_RESPONSE_CLASSIFY_SYSTEM_PROMPT,
      PROBE_RESPONSE_CLASSIFY_USER_TEMPLATE({
        question,
        response,
      }),
      { enabled: guardOn, injection: true },
    );

    try {
      const result = await this.llm.call({
        taskType: 'probe-response-classify',
        systemPrompt: guarded.system,
        userMessage: guarded.user,
        tenantId: args.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: PROBE_RESPONSE_CLASSIFY_SCHEMA_NAME,
          schema: PROBE_RESPONSE_CLASSIFY_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'probe-response', id: args.probeId },
        dataClass: 'internal',
      });

      const parsed = JSON.parse(result.text) as {
        answer?: unknown;
        confidence?: unknown;
        requiresFollowup?: unknown;
      };
      const answer = typeof parsed.answer === 'string' ? parsed.answer : '';
      const confidence =
        typeof parsed.confidence === 'number' &&
        Number.isFinite(parsed.confidence)
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0;

      const minConfidence = this.cfg.probe.responseClassifyMinConfidence;
      if (confidence >= minConfidence) {
        const bucket: 'high' | 'medium' = confidence >= 0.85 ? 'high' : 'medium';
        this.metrics.incProbeResponseClassified({ confidence_bucket: bucket });
        return { answer, confidence, unclear: false };
      }

      // Низкая уверенность — помечаем unclear, но closing-loop не блокируем.
      this.metrics.incProbeResponseUnclear({
        originalReason: args.probeReason,
      });
      this.metrics.incProbeResponseClassified({ confidence_bucket: 'low' });
      return { answer, confidence, unclear: true };
    } catch (err) {
      this.logger.warn(
        {
          probeId: args.probeId,
          err: err instanceof Error ? err.message : String(err),
        },
        'ProbeResponseHandler: probe-response-classify упал — пропускаю классификацию',
      );
      return null;
    }
  }

  /**
   * Извлекает текст свободного ответа из payload события. Поддерживаются
   * популярные ключи: `text`, `response`, `body`, `answer`. Если payload
   * целиком строка — берём её. Если ничего не нашли — `undefined`.
   */
  private extractResponseText(
    payload: Record<string, unknown>,
  ): string | undefined {
    if (typeof payload === 'string') return payload;
    for (const key of ['text', 'response', 'body', 'answer'] as const) {
      const v = payload[key];
      if (typeof v === 'string' && v.trim().length > 0) return v.trim();
    }
    return undefined;
  }

  private toStringOrUndef(v: unknown): string | undefined {
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  }

  /**
   * Записывает ответ как `RawEvent` через ConversationalIngestAdapter.
   * Ошибки логируем, но не пробрасываем — основной flow ответа
   * (Notification.respondedAt) уже завершён, дублировать его не нужно.
   */
  private async ingestResponseAsRawEvent(args: {
    tenantId: string;
    userId: string;
    notificationId: string;
    eventType: string;
    payload: Record<string, unknown>;
    sourceChannelKind: string | null;
    contextBlockId: string | null;
    contextCardId: string | null;
  }): Promise<void> {
    try {
      await this.ingestAdapter.ingestNotificationResponse({
        tenantId: args.tenantId,
        userId: args.userId,
        notificationId: args.notificationId,
        eventType: args.eventType,
        payload: args.payload as Record<string, unknown>,
        sourceChannelKind: args.sourceChannelKind,
        contextBlockId: args.contextBlockId,
        contextCardId: args.contextCardId,
      });
    } catch (err) {
      this.logger.warn(
        {
          notificationId: args.notificationId,
          err: err instanceof Error ? err.message : String(err),
        },
        'ProbeResponseHandler: ingestNotificationResponse упал — продолжаю',
      );
    }
  }

  /**
   * Нормализация tenant-id для метрики (контроль cardinality).
   * Сейчас используем первые 8 символов tenantId — этого достаточно, чтобы
   * различать ~top-100 тенантов. Полноценная top-100 нормализация — γ+.
   */
  private normalizeTenantTop(tenantId: string): string {
    if (!tenantId) return 'other';
    return tenantId.slice(0, 8);
  }

  /** Берём kind первого NotificationDelivery, у которого есть channel. */
  private async lookupDeliveryKind(
    notificationId: string,
  ): Promise<string | null> {
    const d = await this.prisma.notificationDelivery.findFirst({
      where: { notificationId },
      include: { channelBinding: { include: { channel: true } } },
    });
    return d?.channelBinding?.channel?.kind ?? null;
  }
}
