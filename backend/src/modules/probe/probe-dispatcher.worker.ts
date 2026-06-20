import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type DataClass } from '@prisma/client';
import { type Job, Worker } from 'bullmq';


import { TypedConfigService } from '../../common/config/index';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { ConversationalService } from '../conversational/conversational.service';
import { CORE_QUEUE_NAMES, type ProbeEventJobData } from '../core-queue/queues';
import { PipelineRunner, SystemLogPipeline } from '../logging/log-pipeline';

import {
  probeEngagementRedisKey,
  probeTopicCooldownRedisKey,
} from './probe-fatigue.util';
import { ProbeFormulationService } from './probe-formulation.service';
import { PROBE_REASON_RECHECK, probeWindow } from './probe-reason-policy';
import { ProbeService } from './probe.service';

@Injectable()
export class ProbeDispatcherWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProbeDispatcherWorker.name);
  private worker: Worker<ProbeEventJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(ProbeService) private readonly probeService: ProbeService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(ProbeFormulationService)
    private readonly formulation: ProbeFormulationService,
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

    const formulated = await this.formulation.formulate(probe);

    const finalQuestion =
      probe.reason === 'skill.cdm_interview'
        ? formulated.question
        : await this.formulation.judgeQuality(probe, formulated.question);

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
          blockId: this.toStringOrUndef(payload.contextBlockId),
          quote: typeof payload.contextQuote === 'string' ? payload.contextQuote : undefined,
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
}
