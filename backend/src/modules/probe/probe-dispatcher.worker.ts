import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type DataClass, type ProbeEvent } from '@prisma/client';
import { type Job, Worker } from 'bullmq';


import { TypedConfigService } from '../../common/config/index';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { LlmRouterService } from '../ai/services/llm-router.service';
import { ConversationalService } from '../conversational/conversational.service';
import { CORE_QUEUE_NAMES, type ProbeEventJobData } from '../core-queue/queues';
import {
  PROBE_FORMULATE_JSON_SCHEMA,
  PROBE_FORMULATE_SCHEMA_NAME,
  PROBE_FORMULATE_SYSTEM_PROMPT,
  PROBE_FORMULATE_USER_TEMPLATE,
} from '../knowledge-core/prompts/probe-formulate.prompt';
import { PipelineRunner, SystemLogPipeline } from '../logging/log-pipeline';

import { ProbeService } from './probe.service';

interface FormulatedProbe {
  question: string;
}

/**
 * SBA β-5 — ProbeDispatcherWorker (Layer 6).
 *
 * Consumer `core.probe-events`. На каждый job:
 *   1. Подгружает ProbeEvent + проверяет, что status='pending'.
 *   2. Re-проверяет rate-limit по recipientCandidates.
 *   3. Выбирает recipient'а (round-robin; engagement_rate weight — γ+).
 *   4. LLM `probe-formulate` → {question} (на fallback берёт
 *      payload.suggestedQuestion / message). Без вариантов ответа —
 *      ожидаем свободный ввод (текст / голос). См. ТЗ Agents v2 Фаза 0.
 *   5. ConversationalService.sendNotification(eventType='probe.question').
 *   6. INC rate-limit counters; обновить ProbeEvent.status='dispatched'.
 *
 * Концепции:
 *   - quiet hours: TODO(γ+) — в β-5 пропускаем (ConversationalService уже
 *     учитывает quiet hours через preferences; здесь deffer не делаем).
 *   - failed delivery → не падаем, ставим status='dispatched' с пометкой
 *     в логе (NotificationDelivery сам отслеживает доставку).
 */
@Injectable()
export class ProbeDispatcherWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProbeDispatcherWorker.name);
  private worker: Worker<ProbeEventJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(ProbeService) private readonly probeService: ProbeService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<ProbeEventJobData>(
      CORE_QUEUE_NAMES.PROBE_EVENTS,
      async (job) =>
        this.pipe.job(SystemLogPipeline.NOTIFICATIONS, 'probe.dispatcher', job, () =>
          this.process(job),
        ),
      {
        connection: this.redis.client,
        concurrency: 2,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        {
          probeEventId: job?.data?.probeEventId,
          attempt: job?.attemptsMade,
          err: err?.message,
        },
        'probe-dispatcher: job failed (повтор по политике BullMQ)',
      );
    });
    this.logger.log(
      `ProbeDispatcherWorker запущен (${CORE_QUEUE_NAMES.PROBE_EVENTS})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  private async process(job: Job<ProbeEventJobData>): Promise<void> {
    const { probeEventId } = job.data;
    const probe = await this.prisma.probeEvent.findUnique({
      where: { id: probeEventId },
    });
    if (!probe) return;
    if (probe.status !== 'pending') return; // уже dispatched / dropped
    if (probe.expiresAt && probe.expiresAt < new Date()) {
      await this.prisma.probeEvent.update({
        where: { id: probe.id },
        data: { status: 'expired' },
      });
      this.metrics.incProbeExpired();
      return;
    }

    // 1. Re-check rate-limit.
    const candidates = await this.probeService.filterByRateLimit(
      probe.recipientCandidates,
    );
    if (candidates.length === 0) {
      await this.prisma.probeEvent.update({
        where: { id: probe.id },
        data: { status: 'dropped_rate_limit' },
      });
      this.metrics.incProbeRateLimitDropped();
      return;
    }

    // 2. Select recipient (round-robin — берём первого; engagement weight γ+).
    const selectedUserId = candidates[0];
    if (!selectedUserId) return;

    // 3. LLM probe-formulate.
    const formulated = await this.formulate(probe);

    // 4. Send notification.
    const payload = (probe.payload ?? {}) as Record<string, unknown>;
    const dataClass = this.extractDataClass(payload);
    try {
      const notif = await this.conversational.sendNotification({
        tenantId: probe.tenantId,
        recipientUserId: selectedUserId,
        eventType: 'probe.question',
        payload: {
          question: formulated.question,
          askedBy: probe.emittedByService,
          context: typeof payload.message === 'string' ? payload.message : undefined,
        },
        dataClass,
        contextBlockId: this.toStringOrUndef(payload.contextBlockId),
        contextCardId: this.toStringOrUndef(payload.contextCardId),
      });

      // 5. INC rate-limit + persist dispatch.
      // Agents v2 Фаза 0.2 (2026-05-30): сохраняем formulatedQuestion в payload
      // ProbeEvent — нужно ProbeResponseHandler'у для классификатора
      // probe-response-classify (точный вопрос вместо reason/message fallback'a).
      await this.probeService.noteSent(selectedUserId);
      await this.prisma.probeEvent.update({
        where: { id: probe.id },
        data: {
          status: 'dispatched',
          dispatchedAt: new Date(),
          selectedRecipientId: selectedUserId,
          dispatchedNotificationId: notif.id,
          payload: {
            ...payload,
            formulatedQuestion: formulated.question,
          },
        },
      });
      this.metrics.incProbeEvent({
        emittedByService: probe.emittedByService,
        reason: probe.reason,
        status: 'dispatched',
      });
      this.metrics.incProbeDispatched({ kind: 'in_app' });
      this.logger.log(
        `probe dispatched: id=${probe.id} userId=${selectedUserId} reason=${probe.reason}`,
      );
    } catch (err) {
      this.logger.warn(
        {
          probeEventId: probe.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'probe-dispatcher: sendNotification упал — попробуем при retry',
      );
      throw err;
    }
  }

  /**
   * LLM probe-formulate с fallback на payload.suggestedQuestion/message.
   *
   * Agents v2 Фаза 0.1 (2026-05-30): убраны options. Ответ ожидаем
   * свободным текстом или голосом (см. ТЗ). `suggestedActions` остаются
   * как контекст для LLM (промпт явно говорит «не перечислять их человеку»).
   */
  private async formulate(probe: ProbeEvent): Promise<FormulatedProbe> {
    const payload = (probe.payload ?? {}) as Record<string, unknown>;
    const message = this.toStringOrUndef(payload.message) ?? '';
    const suggestedQuestion = this.toStringOrUndef(payload.suggestedQuestion);
    const suggestedActions = this.toStringArray(payload.suggestedActions);

    const fallbackQuestion =
      suggestedQuestion ?? (message.length > 0 ? message.slice(0, 200) : 'Можете уточнить?');
    const fallback: FormulatedProbe = {
      question: fallbackQuestion,
    };

    try {
      const contextKind = this.toStringOrUndef(payload.contextCardKind);
      const contextTitle = this.toStringOrUndef(payload.contextCardTitle);
      const result = await this.llm.call({
        taskType: 'probe-formulate',
        systemPrompt: PROBE_FORMULATE_SYSTEM_PROMPT,
        userMessage: PROBE_FORMULATE_USER_TEMPLATE({
          emittedByService: probe.emittedByService,
          reason: probe.reason,
          message,
          suggestedActions,
          contextCard:
            contextKind && contextTitle
              ? { kind: contextKind, title: contextTitle }
              : null,
        }),
        tenantId: probe.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: PROBE_FORMULATE_SCHEMA_NAME,
          schema: PROBE_FORMULATE_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'probe', id: probe.id },
        dataClass: this.extractDataClass(payload),
      });
      const parsed = JSON.parse(result.text) as FormulatedProbe;
      if (
        parsed &&
        typeof parsed.question === 'string' &&
        parsed.question.length > 0
      ) {
        return {
          question: parsed.question.slice(0, 400),
        };
      }
      return fallback;
    } catch (err) {
      this.logger.debug(
        {
          probeEventId: probe.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'probe-dispatcher: probe-formulate fallback',
      );
      return fallback;
    }
  }

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

  private toStringOrUndef(v: unknown): string | undefined {
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  }

  private toStringArray(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
  }
}
