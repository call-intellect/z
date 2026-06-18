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
  probeEngagementRedisKey,
  probeTopicCooldownRedisKey,
} from './probe-fatigue.util';
import {
  PROBE_REASON_FALLBACK,
  PROBE_REASON_FALLBACK_DEFAULT,
  PROBE_REASON_LABEL,
  PROBE_REASON_LABEL_DEFAULT,
} from './probe-reason-labels';
import { PROBE_REASON_RECHECK, probeWindow } from './probe-reason-policy';
import { ProbeService } from './probe.service';
import {
  PROBE_QUALITY_JUDGE_JSON_SCHEMA,
  PROBE_QUALITY_JUDGE_SCHEMA_NAME,
  PROBE_QUALITY_JUDGE_SYSTEM_PROMPT,
  PROBE_QUALITY_JUDGE_USER,
} from './prompts/probe-quality-judge.prompt';

interface FormulatedProbe {
  question: string;
}

interface ProbeQualityVerdict {
  ok: boolean;
  issues?: string[];
  rewrite?: string;
}

export function passesMarkerCheck(q: string): boolean {
  const text = (q ?? '').trim();
  if (text.length === 0) return false;
  if (text.length > 400) return false;
  const questionMarks = (text.match(/\?/g) ?? []).length;
  if (questionMarks !== 1) return false;
  if (/[A-Za-z]{4,}/.test(text)) return false;
  if (/[A-Za-z0-9]{16,}/.test(text)) return false;
  return true;
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
    if (probe.status !== 'pending') return;
    if (probe.expiresAt && probe.expiresAt < new Date()) {
      await this.prisma.probeEvent.update({
        where: { id: probe.id },
        data: { status: 'expired' },
      });
      this.metrics.incProbeExpired();
      return;
    }

    const candidates = await this.probeService.filterByRateLimit(
      probe.recipientCandidates,
    );
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
      this.logger.log(
        `probe отложен в дайджест: priority < immediatePushMinPriority (id=${probe.id} priority=${probe.priority} порог=${minPriority})`,
      );
      return;
    }

    const selectedUserId = await this.selectRecipient(candidates);
    if (!selectedUserId) return;

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

    const formulated = await this.formulate(probe);

    const finalQuestion =
      probe.reason === 'skill.cdm_interview'
        ? formulated.question
        : await this.judgeQuality(probe, formulated.question);

    const payload = (probe.payload ?? {}) as Record<string, unknown>;
    const dataClass = this.extractDataClass(payload);
    try {
      const notif = await this.conversational.sendNotification({
        tenantId: probe.tenantId,
        recipientUserId: selectedUserId,
        eventType: 'probe.question',
        payload: {
          question: finalQuestion,
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
            formulatedQuestion: finalQuestion,
          },
        },
      });
      this.metrics.incProbeEvent({
        emittedByService: probe.emittedByService,
        reason: probe.reason,
        status: 'dispatched',
      });
      const dispatchedKind = await this.lookupDeliveryKind(notif.id);
      this.metrics.incProbeDispatched({ kind: dispatchedKind ?? 'in_app' });
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

  private async formulate(probe: ProbeEvent): Promise<FormulatedProbe> {
    const payload = (probe.payload ?? {}) as Record<string, unknown>;
    const message = this.toStringOrUndef(payload.message) ?? '';
    const suggestedQuestion = this.toStringOrUndef(payload.suggestedQuestion);
    const suggestedActions = this.toStringArray(payload.suggestedActions);

    if (probe.reason === 'skill.cdm_interview' && suggestedQuestion) {
      return { question: suggestedQuestion };
    }

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
      const guardOn =
        this.cfg.aiFeatures?.promptInjectionGuardEnabled !== false;
      const reasonLabel =
        PROBE_REASON_LABEL[probe.reason] ?? PROBE_REASON_LABEL_DEFAULT;
      const isReask = this.readReaskCount(payload) >= 1;
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
          isReask,
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

  private async judgeQuality(
    probe: ProbeEvent,
    question: string,
  ): Promise<string> {
    let enabled: boolean;
    try {
      enabled = await this.cfg.getDynamic<boolean>(
        'probe.qualityJudgeEnabled',
        undefined,
        true,
      );
    } catch {
      enabled = true;
    }
    if (!enabled) return question;

    const payload = (probe.payload ?? {}) as Record<string, unknown>;
    try {
      const guardOn = this.cfg.aiFeatures?.promptInjectionGuardEnabled !== false;
      const guarded = applyInputGuards(
        PROBE_QUALITY_JUDGE_SYSTEM_PROMPT,
        PROBE_QUALITY_JUDGE_USER({ question }),
        { enabled: guardOn, injection: true },
      );
      const result = await this.llm.call({
        taskType: 'probe-quality-judge',
        systemPrompt: guarded.system,
        userMessage: guarded.user,
        tenantId: probe.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: PROBE_QUALITY_JUDGE_SCHEMA_NAME,
          schema: PROBE_QUALITY_JUDGE_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'probe', id: probe.id },
        dataClass: this.extractDataClass(payload),
      });
      const verdict = JSON.parse(result.text) as ProbeQualityVerdict;
      if (verdict && verdict.ok === true) {
        this.metrics.incProbeQualityJudged({ verdict: 'ok' });
        return question;
      }
      const rewrite =
        typeof verdict?.rewrite === 'string' ? verdict.rewrite.trim() : '';
      if (verdict && verdict.ok === false && passesMarkerCheck(rewrite)) {
        this.metrics.incProbeQualityJudged({ verdict: 'rewritten' });
        this.logger.log(
          `probe-quality-judge: вопрос переформулирован (id=${probe.id} issues=${(verdict.issues ?? []).join(',')})`,
        );
        return rewrite;
      }
      this.metrics.incProbeQualityJudged({ verdict: 'kept_on_fail' });
      return question;
    } catch (err) {
      this.logger.debug(
        {
          probeEventId: probe.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'probe-dispatcher: probe-quality-judge упал — отправляю исходный вопрос (best-effort)',
      );
      this.metrics.incProbeQualityJudged({ verdict: 'kept_on_fail' });
      return question;
    }
  }

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
      /* eslint-disable-next-line no-empty */
    }
  }

  private async selectRecipient(candidates: string[]): Promise<string | undefined> {
    if (candidates.length === 0) return undefined;
    if (candidates.length === 1) return candidates[0];

    let enabled: boolean;
    try {
      enabled = await this.cfg.getDynamic<boolean>(
        'probe.engagementRoutingEnabled',
        undefined,
        true,
      );
    } catch {
      enabled = true;
    }
    if (!enabled) return candidates[0];

    const scored: Array<{ userId: string; rate: number }> = [];
    for (const userId of candidates) {
      let rate = 0.5;
      try {
        const raw = await this.redis.client.get(
          probeEngagementRedisKey(userId),
        );
        const parsed = raw != null ? Number(raw) : Number.NaN;
        if (Number.isFinite(parsed)) rate = parsed;
      } catch {
        /* eslint-disable-next-line no-empty */
      }
      scored.push({ userId, rate });
    }

    scored.sort((a, b) => {
      if (b.rate !== a.rate) return b.rate - a.rate;
      return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
    });
    return scored[0]!.userId;
  }

  private async lookupDeliveryKind(
    notificationId: string,
  ): Promise<string | null> {
    try {
      const d = await this.prisma.notificationDelivery.findFirst({
        where: { notificationId },
        include: { channelBinding: { include: { channel: true } } },
      });
      return d?.channelBinding?.channel?.kind ?? null;
    } catch (err) {
      this.logger.debug(
        {
          notificationId,
          err: err instanceof Error ? err.message : String(err),
        },
        'probe-dispatcher: lookupDeliveryKind упал — fallback in_app',
      );
      return null;
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

  private readReaskCount(payload: Record<string, unknown>): number {
    const raw = payload.reaskCount;
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) ? n : 0;
  }

  private toStringArray(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
  }
}
