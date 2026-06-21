import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { type DataClass, Prisma } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { CoreQueueService } from '../core-queue/core-queue.service';
import { EmbeddingFallbackService } from '../embeddings/services/embedding-fallback.service';

import {
  PROBE_LOW_ENGAGEMENT_BUDGET_FACTOR,
  PROBE_LOW_ENGAGEMENT_THRESHOLD,
  probeEngagementRedisKey,
  probeTopicCooldownRedisKey,
} from './probe-fatigue.util';
import {
  MACHINE_FILLABLE_REASONS,
  NUDGE_REASONS,
  probeWindow,
  resolveProbeProvenance,
} from './probe-reason-policy';
import type {
  ProbeSuggestInput,
  ProbeSuggestPayload,
  ProbeSuggestResult,
} from './probe.types';

@Injectable()
export class ProbeService {
  private readonly logger = new Logger(ProbeService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(CoreQueueService) private readonly queue: CoreQueueService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(EmbeddingFallbackService)
    private readonly embeddings: EmbeddingFallbackService,
  ) {}

  async suggest(input: ProbeSuggestInput): Promise<ProbeSuggestResult> {
    try {
      if (!input.tenantId || !input.emittedByService || !input.reason) {
        return { dropped: 'dedup' };
      }
      if (input.recipientCandidates.length === 0) {
        this.metrics.incProbeEvent({
          emittedByService: input.emittedByService,
          reason: input.reason,
          status: 'dropped_dedup',
        });
        return { dropped: 'dedup' };
      }

      let suppressOnUnconfirmedAuto = true;
      try {
        suppressOnUnconfirmedAuto = await this.cfg.getDynamic<boolean>(
          'probe.suppressOnUnconfirmedAuto',
          undefined,
          true,
        );
      } catch {
        suppressOnUnconfirmedAuto = true;
      }
      if (suppressOnUnconfirmedAuto) {
        let machineFillable: string[];
        try {
          const raw = await this.cfg.getDynamic<string[]>(
            'probe.machineFillableReasons',
            undefined,
            [...MACHINE_FILLABLE_REASONS],
          );
          machineFillable = Array.isArray(raw)
            ? raw
            : [...MACHINE_FILLABLE_REASONS];
        } catch {
          machineFillable = [...MACHINE_FILLABLE_REASONS];
        }
        if (machineFillable.includes(input.reason)) {
          const provenance = await resolveProbeProvenance(input.reason, {
            prisma: this.prisma,
            tenantId: input.tenantId,
            contextCardId:
              typeof input.payload.contextCardId === 'string'
                ? input.payload.contextCardId
                : null,
            contextCardKind:
              typeof input.payload.contextCardKind === 'string'
                ? input.payload.contextCardKind
                : null,
          });
          if (provenance === 'auto_unconfirmed') {
            this.metrics.incProbeEvent({
              emittedByService: input.emittedByService,
              reason: input.reason,
              status: 'dropped_policy_silent',
            });
            this.logger.log(
              `policy-gate: probe заглушён на авто-неподтверждённой записи (reason=${input.reason} tenant=${input.tenantId} card=${input.payload.contextCardId})`,
            );
            return { dropped: 'policy_silent' };
          }
        }
      }

      const notBeforeAt = input.notBeforeAt ?? null;

      const contentHash = this.computeContentHash({
        reason: input.reason,
        payload: input.payload,
      });

      try {
        const cooling = await this.redis.client.get(
          probeTopicCooldownRedisKey(input.tenantId, contentHash),
        );
        if (cooling) {
          this.metrics.incProbeDedupDropped({ reason: input.reason });
          this.metrics.incProbeEvent({
            emittedByService: input.emittedByService,
            reason: input.reason,
            status: 'dropped_dedup',
          });
          return { dropped: 'dedup' };
        }
      } catch {
        /* eslint-disable-next-line no-empty */
      }

      const dedupKey = `probe:dedup:${input.tenantId}:${contentHash}`;
      const ttlSec = this.cfg.probe.dedupTtlHours * 3600;
      try {
        const setRes = await this.redis.client.set(
          dedupKey,
          '1',
          'EX',
          ttlSec,
          'NX',
        );
        if (setRes === null) {
          this.metrics.incProbeDedupDropped({ reason: input.reason });
          this.metrics.incProbeEvent({
            emittedByService: input.emittedByService,
            reason: input.reason,
            status: 'dropped_dedup',
          });
          return { dropped: 'dedup' };
        }
      } catch (err) {
        this.logger.warn(
          {
            tenantId: input.tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'ProbeService.suggest: Redis dedup check failed — продолжаю без дедупа',
        );
      }

      const questionVectorLiteral = await this.maybeSemanticDedup({
        tenantId: input.tenantId,
        payload: input.payload,
      });
      if (questionVectorLiteral === 'DEDUP') {
        this.metrics.incProbeDedupDropped({ reason: input.reason });
        this.metrics.incProbeEvent({
          emittedByService: input.emittedByService,
          reason: input.reason,
          status: 'dropped_dedup',
        });
        return { dropped: 'dedup' };
      }

      const availableRecipients = await this.filterByRateLimit(
        input.recipientCandidates,
      );
      if (availableRecipients.length === 0) {
        if (probeWindow(input.reason) === 'deferrable') {
          const priority = Math.round(
            this.clamp01(input.priorityHint ?? 0.4) * 100,
          );
          const queued = await this.prisma.probeEvent.create({
            data: {
              tenantId: input.tenantId,
              emittedByService: input.emittedByService,
              reason: input.reason,
              payload: this.payloadToJson(input.payload),
              recipientCandidates: [...input.recipientCandidates],
              contentHash,
              priority,
              status: 'queued_digest',
              expiresAt: this.computeExpiresAt(),
              notBeforeAt,
            },
          });
          this.metrics.incProbeEvent({
            emittedByService: input.emittedByService,
            reason: input.reason,
            status: 'queued_digest',
          });
          return { ok: true, probeEventId: queued.id };
        }
        this.metrics.incProbeRateLimitDropped();
        this.metrics.incProbeEvent({
          emittedByService: input.emittedByService,
          reason: input.reason,
          status: 'dropped_rate_limit',
        });
        await this.prisma.probeEvent.create({
          data: {
            tenantId: input.tenantId,
            emittedByService: input.emittedByService,
            reason: input.reason,
            payload: this.payloadToJson(input.payload),
            recipientCandidates: [...input.recipientCandidates],
            contentHash,
            priority: 0,
            status: 'dropped_rate_limit',
          },
        });
        return { dropped: 'rate_limit' };
      }

      const coldStart = await this.isColdStart(input.tenantId);
      if (coldStart) {
        this.metrics.incProbeColdStartDropped();
        const deferred = await this.prisma.probeEvent.create({
          data: {
            tenantId: input.tenantId,
            emittedByService: input.emittedByService,
            reason: input.reason,
            payload: this.payloadToJson(input.payload),
            recipientCandidates: [...availableRecipients],
            contentHash,
            priority: Math.round(this.clamp01(input.priorityHint ?? 0.4) * 100),
            status: 'routed_to_digest',
            expiresAt: this.computeExpiresAt(),
            notBeforeAt,
          },
        });
        this.metrics.incProbeEvent({
          emittedByService: input.emittedByService,
          reason: input.reason,
          status: 'routed_to_digest',
        });
        this.logger.log(
          `cold-start: probe отложен в дайджест (id=${deferred.id} tenant=${input.tenantId} reason=${input.reason})`,
        );
        return { ok: true, probeEventId: deferred.id };
      }

      const severityWeight = this.clamp01(input.priorityHint ?? 0.4);
      const priority = Math.round(severityWeight * 100);
      const dataClass: DataClass = input.dataClass ?? 'internal';

      let minValuePriority: number;
      try {
        minValuePriority = await this.cfg.getDynamic<number>(
          'probe.minValuePriority',
          undefined,
          30,
        );
      } catch {
        minValuePriority = 30;
      }
      if (priority < minValuePriority) {
        this.metrics.incProbeEvent({
          emittedByService: input.emittedByService,
          reason: input.reason,
          status: 'dropped_low_value',
        });
        await this.prisma.probeEvent.create({
          data: {
            tenantId: input.tenantId,
            emittedByService: input.emittedByService,
            reason: input.reason,
            payload: this.payloadToJson({ ...input.payload, dataClass }),
            recipientCandidates: [...availableRecipients],
            contentHash,
            priority,
            status: 'dropped_low_value',
          },
        });
        return { dropped: 'low_value' };
      }

      if (NUDGE_REASONS.has(input.reason)) {
        const nudge = await this.prisma.probeEvent.create({
          data: {
            tenantId: input.tenantId,
            emittedByService: input.emittedByService,
            reason: input.reason,
            payload: this.payloadToJson({ ...input.payload, dataClass }),
            recipientCandidates: [...availableRecipients],
            contentHash,
            priority,
            status: 'routed_to_digest',
            expiresAt: this.computeExpiresAt(),
            notBeforeAt,
          },
        });
        this.metrics.incProbeEvent({
          emittedByService: input.emittedByService,
          reason: input.reason,
          status: 'routed_to_digest',
        });
        return { ok: true, probeEventId: nudge.id };
      }

      const expiresAt = this.computeExpiresAt();
      const event = await this.prisma.probeEvent.create({
        data: {
          tenantId: input.tenantId,
          emittedByService: input.emittedByService,
          reason: input.reason,
          payload: this.payloadToJson({ ...input.payload, dataClass }),
          recipientCandidates: [...availableRecipients],
          contentHash,
          priority,
          status: 'pending',
          expiresAt,
          notBeforeAt,
        },
      });

      if (questionVectorLiteral) {
        try {
          await this.prisma.$executeRawUnsafe(
            'UPDATE "probe_events" SET "questionEmbedding" = $1::vector WHERE id = $2',
            questionVectorLiteral,
            event.id,
          );
        } catch (err) {
          this.logger.warn(
            {
              probeEventId: event.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'ProbeService.suggest: не удалось записать questionEmbedding — probe создан без эмбеддинга',
          );
        }
      }

      this.metrics.incProbeEvent({
        emittedByService: input.emittedByService,
        reason: input.reason,
        status: 'pending',
      });

      const delayMs =
        notBeforeAt && notBeforeAt.getTime() > Date.now()
          ? notBeforeAt.getTime() - Date.now()
          : 0;
      try {
        await this.queue.enqueueProbeEvent({
          probeEventId: event.id,
          ...(delayMs > 0 ? { delayMs } : {}),
        });
      } catch (err) {
        this.logger.warn(
          {
            probeEventId: event.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'ProbeService.suggest: enqueueProbeEvent failed — probe не уйдёт пока cron не подберёт',
        );
      }

      return { ok: true, probeEventId: event.id };
    } catch (err) {
      this.logger.error(
        {
          tenantId: input.tenantId,
          emittedByService: input.emittedByService,
          reason: input.reason,
          err: err instanceof Error ? err.message : String(err),
        },
        'ProbeService.suggest: внутренняя ошибка — возвращаю dropped:dedup',
      );
      return { dropped: 'dedup' };
    }
  }

  private async maybeSemanticDedup(args: {
    tenantId: string;
    payload: ProbeSuggestPayload;
  }): Promise<'DEDUP' | string | null> {
    let enabled: boolean;
    try {
      enabled = await this.cfg.getDynamic<boolean>(
        'probe.semanticDedupEnabled',
        undefined,
        true,
      );
    } catch {
      enabled = true;
    }
    if (!enabled) return null;

    const rawText = args.payload.suggestedQuestion ?? args.payload.message;
    if (typeof rawText !== 'string') return null;
    const text = rawText.trim();
    if (text.length === 0) return null;

    let vector: number[] | undefined;
    try {
      const vecs = await this.embeddings.embed([text]);
      vector = vecs[0];
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'ProbeService.maybeSemanticDedup: embed упал — пропускаю семантику',
      );
      return null;
    }
    if (!vector || vector.length === 0) return null;
    const vectorLiteral = `[${vector.join(',')}]`;

    let threshold: number;
    let windowHours: number;
    try {
      threshold = await this.cfg.getDynamic<number>(
        'probe.semanticDedupThreshold',
        undefined,
        0.92,
      );
    } catch {
      threshold = 0.92;
    }
    try {
      windowHours = await this.cfg.getDynamic<number>(
        'probe.semanticDedupWindowHours',
        undefined,
        72,
      );
    } catch {
      windowHours = 72;
    }

    try {
      const rows = await this.prisma.$queryRawUnsafe<
        Array<{ id: string; distance: number }>
      >(
        `SELECT id, ("questionEmbedding" <=> $1::vector) AS distance
         FROM "probe_events"
         WHERE "tenantId" = $2
           AND status IN ('pending','dispatched','queued_digest','routed_to_digest')
           AND "questionEmbedding" IS NOT NULL
           AND "createdAt" > now() - make_interval(hours => $3::int)
         ORDER BY "questionEmbedding" <=> $1::vector
         LIMIT 1`,
        vectorLiteral,
        args.tenantId,
        Math.max(0, Math.round(windowHours)),
      );
      const top = rows[0];
      if (top && Number.isFinite(Number(top.distance))) {
        const similarity = 1 - Number(top.distance);
        if (similarity >= threshold) {
          this.logger.log(
            `semantic-dedup: probe близок к ${top.id} (sim=${similarity.toFixed(
              3,
            )} ≥ ${threshold}) tenant=${args.tenantId} — drop`,
          );
          return 'DEDUP';
        }
      }
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'ProbeService.maybeSemanticDedup: KNN-запрос упал — пропускаю семантику',
      );
    }

    return vectorLiteral;
  }

  async filterByRateLimit(
    recipientCandidates: readonly string[],
  ): Promise<string[]> {
    const limitHour = this.cfg.probe.rateLimitPerHour;
    const limitDay = this.cfg.probe.rateLimitPerDay;
    let adaptiveOn: boolean;
    try {
      adaptiveOn = await this.cfg.getDynamic<boolean>(
        'probe.adaptiveFatigueEnabled',
        undefined,
        true,
      );
    } catch {
      adaptiveOn = true;
    }
    const available: string[] = [];
    for (const userId of recipientCandidates) {
      try {
        const [hourCount, dayCount, engagementRaw] = await Promise.all([
          this.redis.client.get(this.hourKey(userId)),
          this.redis.client.get(this.dayKey(userId)),
          adaptiveOn
            ? this.redis.client.get(probeEngagementRedisKey(userId))
            : Promise.resolve(null),
        ]);
        let effHour = limitHour;
        let effDay = limitDay;
        if (adaptiveOn && engagementRaw != null) {
          const eng = Number(engagementRaw);
          if (Number.isFinite(eng) && eng < PROBE_LOW_ENGAGEMENT_THRESHOLD) {
            effHour = Math.max(
              1,
              Math.floor(limitHour * PROBE_LOW_ENGAGEMENT_BUDGET_FACTOR),
            );
            effDay = Math.max(
              1,
              Math.floor(limitDay * PROBE_LOW_ENGAGEMENT_BUDGET_FACTOR),
            );
          }
        }
        if (
          (hourCount && Number(hourCount) >= effHour) ||
          (dayCount && Number(dayCount) >= effDay)
        ) {
          continue;
        }
        available.push(userId);
      } catch {
        available.push(userId);
      }
    }
    return available;
  }

  async noteSent(userId: string): Promise<void> {
    try {
      await this.redis.client.multi()
        .incr(this.hourKey(userId))
        .expire(this.hourKey(userId), 3600)
        .incr(this.dayKey(userId))
        .expire(this.dayKey(userId), 86400)
        .exec();
    } catch {
      /* eslint-disable-next-line no-empty */
    }
  }

  private async isColdStart(tenantId: string): Promise<boolean> {
    const windowHours = this.cfg.probe.coldStartModeHours;
    if (windowHours <= 0) return false;
    const earliest = await this.prisma.probeEvent.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    if (!earliest) return false;
    const elapsedMs = Date.now() - earliest.createdAt.getTime();
    return elapsedMs < windowHours * 3600 * 1000;
  }

  private computeContentHash(args: {
    reason: string;
    payload: ProbeSuggestPayload;
  }): string {
    const ids: string[] = [];
    if (args.payload.contextBlockId) ids.push(`b:${args.payload.contextBlockId}`);
    if (args.payload.contextCardId) ids.push(`c:${args.payload.contextCardId}`);
    if (args.payload.contextIds) {
      for (const id of args.payload.contextIds) ids.push(`x:${id}`);
    }
    ids.sort();
    const buf = `${args.reason}|${ids.join('|')}|${args.payload.message ?? ''}`;
    return createHash('sha256').update(buf).digest('hex').slice(0, 64);
  }

  private hourKey(userId: string): string {
    const hourBucket = Math.floor(Date.now() / 3600_000);
    return `probe:ratelimit:${userId}:h:${hourBucket}`;
  }

  private dayKey(userId: string): string {
    const dayBucket = Math.floor(Date.now() / 86400_000);
    return `probe:ratelimit:${userId}:d:${dayBucket}`;
  }

  private clamp01(v: number): number {
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(1, v));
  }

  private computeExpiresAt(): Date {
    return new Date(Date.now() + this.cfg.probe.expiryDays * 24 * 3600 * 1000);
  }

  private payloadToJson(payload: ProbeSuggestPayload): Prisma.InputJsonValue {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload)) {
      if (v === undefined) continue;
      out[k] = v;
    }
    return out as Prisma.InputJsonValue;
  }
}
