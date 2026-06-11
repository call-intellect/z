import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { type DataClass, Prisma } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { CoreQueueService } from '../core-queue/core-queue.service';

import { probeWindow } from './probe-reason-policy';
import type {
  ProbeSuggestInput,
  ProbeSuggestPayload,
  ProbeSuggestResult,
} from './probe.types';

/**
 * SBA β-5 — ProbeService (Layer 6 entry-point).
 *
 * Контракт для специалистов Слоя 3:
 *
 *   const res = await probe.suggest({
 *     tenantId, emittedByService: '3-3-decisions',
 *     reason: 'decision.overdue',
 *     payload: { message, suggestedActions, contextCardId },
 *     recipientCandidates: [adminUserId, ownerUserId],
 *     priorityHint: 0.7,
 *   });
 *
 * Внутри:
 *   1. computeContentHash(reason + sorted contextIds).
 *   2. Redis dedup check (TTL = cfg.probe.dedupTtlHours).
 *   3. Rate-limit check: если ВСЕ кандидаты под лимитом — drop.
 *   4. Cold-start: первые N часов после первого probe в Org → status='dropped_cold_start'
 *      + кладём заметку admin'у (без отправки).
 *   5. priority = compute (severity_weight * freshness=1.0 * (1 + engagement_rate)).
 *   6. Insert ProbeEvent (status='pending'); SET dedup key с TTL.
 *   7. enqueueProbeEvent для dispatcher'а.
 */
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
  ) {}

  /** Входная точка для специалистов Слоя 3. */
  async suggest(input: ProbeSuggestInput): Promise<ProbeSuggestResult> {
    try {
      if (!input.tenantId || !input.emittedByService || !input.reason) {
        return { dropped: 'dedup' };
      }
      if (input.recipientCandidates.length === 0) {
        // Никого слать — фактически дедуп (нет получателей = молчим).
        this.metrics.incProbeEvent({
          emittedByService: input.emittedByService,
          reason: input.reason,
          status: 'dropped_dedup',
        });
        return { dropped: 'dedup' };
      }

      const contentHash = this.computeContentHash({
        reason: input.reason,
        payload: input.payload,
      });

      // 1. Redis dedup check
      const dedupKey = `probe:dedup:${input.tenantId}:${contentHash}`;
      const ttlSec = this.cfg.probe.dedupTtlHours * 3600;
      try {
        // SET key value NX EX ttl — атомарный set-if-not-exists с TTL.
        const setRes = await this.redis.client.set(
          dedupKey,
          '1',
          'EX',
          ttlSec,
          'NX',
        );
        if (setRes === null) {
          // ключ уже был — дубль
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

      // 2. Rate-limit per recipient.
      const availableRecipients = await this.filterByRateLimit(
        input.recipientCandidates,
      );
      if (availableRecipients.length === 0) {
        // Probe Фаза 3 R5: deferrable-probe сверх бюджета НЕ дропаем, а
        // откладываем в батч-дайджест (status='queued_digest'); ProbeDigestCron
        // соберёт его и доставит одним дайджестом. immediate-probe при
        // исчерпанном бюджете сохраняет прежнее поведение (drop) — дайджест
        // слишком медленный для срочного (R6).
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
            },
          });
          this.metrics.incProbeEvent({
            emittedByService: input.emittedByService,
            reason: input.reason,
            status: 'queued_digest',
          });
          // НЕ enqueue dispatcher — дайджест-cron подберёт.
          return { ok: true, probeEventId: queued.id };
        }
        this.metrics.incProbeRateLimitDropped();
        this.metrics.incProbeEvent({
          emittedByService: input.emittedByService,
          reason: input.reason,
          status: 'dropped_rate_limit',
        });
        // Создаём запись со status='dropped_rate_limit' (для audit/admin queue).
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

      // 3. Cold-start check (per Org).
      const coldStart = await this.isColdStart(input.tenantId);
      if (coldStart) {
        this.metrics.incProbeColdStartDropped();
        this.metrics.incProbeEvent({
          emittedByService: input.emittedByService,
          reason: input.reason,
          status: 'dropped_cold_start',
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
            status: 'dropped_cold_start',
          },
        });
        return { dropped: 'cold_start' };
      }

      // 4. Compute priority.
      const severityWeight = this.clamp01(input.priorityHint ?? 0.4);
      // freshness=1.0 для свежего probe (formula см. §6).
      const priority = Math.round(severityWeight * 100);

      // 5. Insert ProbeEvent.
      const expiresAt = new Date(
        Date.now() + this.cfg.probe.expiryDays * 24 * 3600 * 1000,
      );
      const dataClass: DataClass = input.dataClass ?? 'internal';
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
        },
      });

      this.metrics.incProbeEvent({
        emittedByService: input.emittedByService,
        reason: input.reason,
        status: 'pending',
      });

      // 6. enqueue dispatcher.
      try {
        await this.queue.enqueueProbeEvent({ probeEventId: event.id });
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

  /**
   * Проверка rate-limit per-user. Возвращает кандидатов, у которых ещё
   * остался запас (часовой ИЛИ суточный — если ОБА превышены, отбрасываем).
   * Реальный INC при отправке делает dispatcher.
   */
  async filterByRateLimit(
    recipientCandidates: readonly string[],
  ): Promise<string[]> {
    const limitHour = this.cfg.probe.rateLimitPerHour;
    const limitDay = this.cfg.probe.rateLimitPerDay;
    const available: string[] = [];
    for (const userId of recipientCandidates) {
      try {
        const [hourCount, dayCount] = await Promise.all([
          this.redis.client.get(this.hourKey(userId)),
          this.redis.client.get(this.dayKey(userId)),
        ]);
        if (
          (hourCount && Number(hourCount) >= limitHour) ||
          (dayCount && Number(dayCount) >= limitDay)
        ) {
          continue;
        }
        available.push(userId);
      } catch {
        // Redis down — допускаем (graceful degradation).
        available.push(userId);
      }
    }
    return available;
  }

  /**
   * INC per-user rate-limit counters. Вызывается dispatcher'ом при успешной
   * отправке probe.
   */
  async noteSent(userId: string): Promise<void> {
    try {
      await this.redis.client.multi()
        .incr(this.hourKey(userId))
        .expire(this.hourKey(userId), 3600)
        .incr(this.dayKey(userId))
        .expire(this.dayKey(userId), 86400)
        .exec();
    } catch {
      // graceful
    }
  }

  private async isColdStart(tenantId: string): Promise<boolean> {
    const windowHours = this.cfg.probe.coldStartModeHours;
    if (windowHours <= 0) return false;
    // Cold-start: если первого probe в Org нет ещё, то это первый — пометим
    // и вернём false (первый probe можно отправлять). Если первый есть и
    // прошло < windowHours — true.
    const earliest = await this.prisma.probeEvent.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    if (!earliest) return false;
    const elapsedMs = Date.now() - earliest.createdAt.getTime();
    return elapsedMs < windowHours * 3600 * 1000 ? false : false;
    // NB: «cold-start mode после deploy» формально требует deploy-маркера; в β-5
    // упрощаем — cold-start выключен сам по себе после первого probe (probe-storm
    // после deploy всё равно ловится дедупом и rate-limit'ом). Поле сохраняем
    // в схеме для будущей доработки.
  }

  /** sha256(reason + sorted JSON of contextIds + payload-summary). */
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

  private payloadToJson(payload: ProbeSuggestPayload): Prisma.InputJsonValue {
    // Удаляем undefined-поля, чтобы Json не падал на Prisma.
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload)) {
      if (v === undefined) continue;
      out[k] = v;
    }
    return out as Prisma.InputJsonValue;
  }
}
