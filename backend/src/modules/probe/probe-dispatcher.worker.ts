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

import { probeTopicCooldownRedisKey } from './probe-fatigue.util';
import {
  PROBE_REASON_FALLBACK,
  PROBE_REASON_FALLBACK_DEFAULT,
  PROBE_REASON_LABEL,
  PROBE_REASON_LABEL_DEFAULT,
} from './probe-reason-labels';
import { PROBE_REASON_RECHECK, probeWindow } from './probe-reason-policy';
import { ProbeService } from './probe.service';

interface FormulatedProbe {
  question: string;
}

export function humanizeProbeFallback(message: string): string {
  const cleaned = message
    .replace(/\b[a-z0-9]{20,}\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:!?»])/g, '$1')
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 200) : 'Можете уточнить, пожалуйста?';
}

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
    this.logger.debug(`ProbeDispatcherWorker запущен (${CORE_QUEUE_NAMES.PROBE_EVENTS})`);
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
    if (probe.status !== 'pending') return;
    if (probe.expiresAt && probe.expiresAt < new Date()) {
      await this.prisma.probeEvent.update({
        where: { id: probe.id },
        data: { status: 'expired' },
      });
      this.metrics.incProbeExpired();
      return;
    }

    const candidates = await this.probeService.filterByRateLimit(probe.recipientCandidates);
    if (candidates.length === 0) {
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

    let minPriority: number;
    try {
      minPriority = await this.cfg.getDynamic<number>(
        'probe.immediatePushMinPriority',
        undefined,
        70,
      );
    } catch {
      minPriority = 70;
    }
    if (probe.priority < minPriority) {
      await this.prisma.probeEvent.update({
        where: { id: probe.id },
        data: { status: 'queued_digest' },
      });
      this.metrics.incProbeEvent({
        emittedByService: probe.emittedByService,
        reason: probe.reason,
        status: 'queued_digest',
      });
      this.logger.debug(
        `probe отложен в дайджест: priority < immediatePushMinPriority (id=${probe.id} priority=${probe.priority} порог=${minPriority})`,
      );
      return;
    }

    const selectedUserId = candidates[0];
    if (!selectedUserId) return;

    const recheck = PROBE_REASON_RECHECK[probe.reason];
    if (recheck) {
      const probePayload = (probe.payload ?? {}) as Record<string, unknown>;
      try {
        const stillRelevant = await recheck({
          prisma: this.prisma,
          tenantId: probe.tenantId,
          contextCardId: this.toStringOrUndef(probePayload.contextCardId) ?? null,
          contextCardKind: this.toStringOrUndef(probePayload.contextCardKind) ?? null,
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
          this.logger.debug(
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

    const formulated = await this.formulate(probe);

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
      await this.setTopicCooldown(probe.tenantId, probe.contentHash);
      this.logger.debug(
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

  private async formulate(probe: ProbeEvent): Promise<FormulatedProbe> {
    const payload = (probe.payload ?? {}) as Record<string, unknown>;
    const message = this.toStringOrUndef(payload.message) ?? '';
    const suggestedQuestion = this.toStringOrUndef(payload.suggestedQuestion);
    const suggestedActions = this.toStringArray(payload.suggestedActions);

    if (probe.reason === 'skill.cdm_interview' && suggestedQuestion) {
      return { question: suggestedQuestion };
    }

    const fallbackQuestion =
      suggestedQuestion ?? PROBE_REASON_FALLBACK[probe.reason] ?? PROBE_REASON_FALLBACK_DEFAULT;
    const fallback: FormulatedProbe = {
      question: fallbackQuestion,
    };

    try {
      const contextKind = this.toStringOrUndef(payload.contextCardKind);
      const contextTitle = this.toStringOrUndef(payload.contextCardTitle);
      const guardOn = this.cfg.aiFeatures?.promptInjectionGuardEnabled !== false;
      const reasonLabel = PROBE_REASON_LABEL[probe.reason] ?? PROBE_REASON_LABEL_DEFAULT;
      const guarded = applyInputGuards(
        PROBE_FORMULATE_SYSTEM_PROMPT,
        PROBE_FORMULATE_USER_TEMPLATE({
          reasonLabel,
          message,
          suggestedActions,
          contextCard:
            contextKind && contextTitle ? { kind: contextKind, title: contextTitle } : null,
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
      if (parsed && typeof parsed.question === 'string' && parsed.question.length > 0) {
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

  private async setTopicCooldown(tenantId: string, contentHash: string): Promise<void> {
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
    } catch {}
  }

  private extractDataClass(payload: Record<string, unknown>): DataClass {
    const dc = payload.dataClass;
    if (dc === 'public' || dc === 'internal' || dc === 'sensitive' || dc === 'private') {
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
