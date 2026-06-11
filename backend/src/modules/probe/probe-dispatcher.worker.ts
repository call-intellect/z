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
import { applyInputGuards } from '../ai/services/prompts/common';
import { ConversationalService } from '../conversational/conversational.service';
import { CORE_QUEUE_NAMES, type ProbeEventJobData } from '../core-queue/queues';
import {
  PROBE_FORMULATE_JSON_SCHEMA,
  PROBE_FORMULATE_SCHEMA_NAME,
  PROBE_FORMULATE_SYSTEM_PROMPT,
  PROBE_FORMULATE_USER_TEMPLATE,
} from '../knowledge-core/prompts/probe-formulate.prompt';
import { PipelineRunner, SystemLogPipeline } from '../logging/log-pipeline';

import {
  PROBE_REASON_FALLBACK,
  PROBE_REASON_FALLBACK_DEFAULT,
  PROBE_REASON_LABEL,
  PROBE_REASON_LABEL_DEFAULT,
} from './probe-reason-labels';
import { probeTopicCooldownRedisKey } from './probe-fatigue.util';
import { PROBE_REASON_RECHECK, probeWindow } from './probe-reason-policy';
import { ProbeService } from './probe.service';

interface FormulatedProbe {
  question: string;
}

/** Человеческий fallback-вопрос: вырезает cuid-подобные токены и обрезает. */
export function humanizeProbeFallback(message: string): string {
  const cleaned = message
    .replace(/\b[a-z0-9]{20,}\b/gi, '') // cuid-подобные длинные токены
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:!?»])/g, '$1')
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 200) : 'Можете уточнить, пожалуйста?';
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
      // Probe Фаза 3 R5: deferrable-probe, исчерпавший бюджет к моменту
      // dispatch, откладываем в дайджест (а не дропаем). immediate — прежний drop.
      if (probeWindow(probe.reason) === 'deferrable') {
        await this.prisma.probeEvent.update({
          where: { id: probe.id },
          data: { status: 'queued_digest' },
        });
        this.metrics.incProbeEvent({
          emittedByService: probe.emittedByService,
          reason: probe.reason,
          status: 'queued_digest',
        });
        return;
      }
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

    // 2b. Probe Фаза 4 (R8) — recheck повода перед dispatch (answer-first lite).
    // Если у reason есть предикат и он показывает, что пробел уже закрылся сам
    // между suggest и dispatch (напр. решающего назначили, владельца указали) —
    // не слать probe, пометить suppressed_stale. Best-effort: ошибка предиката
    // → продолжаем отправку (не блокируем из-за сбоя re-read).
    const recheck = PROBE_REASON_RECHECK[probe.reason];
    if (recheck) {
      const probePayload = (probe.payload ?? {}) as Record<string, unknown>;
      try {
        const stillRelevant = await recheck({
          prisma: this.prisma,
          tenantId: probe.tenantId,
          contextCardId: this.toStringOrUndef(probePayload.contextCardId) ?? null,
          contextCardKind:
            this.toStringOrUndef(probePayload.contextCardKind) ?? null,
        });
        if (!stillRelevant) {
          await this.prisma.probeEvent.update({
            where: { id: probe.id },
            data: { status: 'suppressed_stale' },
          });
          this.metrics.incProbeEvent({
            emittedByService: probe.emittedByService,
            reason: probe.reason,
            status: 'suppressed_stale',
          });
          this.logger.log(
            `probe suppressed_stale: id=${probe.id} reason=${probe.reason} (повод закрылся между suggest и dispatch)`,
          );
          return;
        }
      } catch (err) {
        this.logger.warn(
          {
            probeEventId: probe.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'probe-dispatcher: recheck повода упал — отправляю probe (best-effort)',
        );
      }
    }

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
      // Probe Фаза 5 (R9) — topic cooldown: тема поднята → не доставать тем же
      // вопросом сразу повторно. Best-effort, не валит dispatch.
      await this.setTopicCooldown(probe.tenantId, probe.contentHash);
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

    // Probe Фаза 1 R3: fallback-вопрос больше НЕ берётся из сырого
    // humanizeProbeFallback(message) (показывал шаблон). Приоритет:
    //   1. suggestedQuestion — готовый человеческий вопрос от специалиста;
    //   2. PROBE_REASON_FALLBACK[reason] — заготовка под тип ситуации;
    //   3. generic «Можете уточнить, пожалуйста?».
    const fallbackQuestion =
      suggestedQuestion ??
      PROBE_REASON_FALLBACK[probe.reason] ??
      PROBE_REASON_FALLBACK_DEFAULT;
    const fallback: FormulatedProbe = {
      question: fallbackQuestion,
    };

    try {
      const contextKind = this.toStringOrUndef(payload.contextCardKind);
      const contextTitle = this.toStringOrUndef(payload.contextCardTitle);
      // A2: оборачиваем сырой пользовательский ввод (message от specialist'a,
      // suggestedActions, заголовок карточки) в анти-инъекционные маркеры.
      // asr не нужен (это не транскрипт). Kill-switch — общий флаг.
      const guardOn =
        this.cfg.aiFeatures?.promptInjectionGuardEnabled !== false;
      const reasonLabel =
        PROBE_REASON_LABEL[probe.reason] ?? PROBE_REASON_LABEL_DEFAULT;
      const guarded = applyInputGuards(
        PROBE_FORMULATE_SYSTEM_PROMPT,
        PROBE_FORMULATE_USER_TEMPLATE({
          reasonLabel,
          message,
          suggestedActions,
          contextCard:
            contextKind && contextTitle
              ? { kind: contextKind, title: contextTitle }
              : null,
        }),
        { enabled: guardOn, injection: true },
      );
      const result = await this.llm.call({
        taskType: 'probe-formulate',
        systemPrompt: guarded.system,
        userMessage: guarded.user,
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

  /**
   * Probe Фаза 5 — поставить тему (`contentHash`) на cooldown в Redis на
   * `probe.topicCooldownHours`. Best-effort: ошибки настройки/Redis не валят
   * dispatch (cooldown просто не применится).
   */
  private async setTopicCooldown(
    tenantId: string,
    contentHash: string,
  ): Promise<void> {
    try {
      const cooldownHours = await this.cfg.getDynamic<number>(
        'probe.topicCooldownHours',
        undefined,
        48,
      );
      const ttlSec = Math.max(1, Math.round(cooldownHours * 3600));
      await this.redis.client.set(
        probeTopicCooldownRedisKey(tenantId, contentHash),
        '1',
        'EX',
        ttlSec,
      );
    } catch {
      // graceful — cooldown не применится.
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
