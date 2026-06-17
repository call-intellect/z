import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { type Prisma } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { CoreQueueService } from '../core-queue/core-queue.service';

import {
  PROBE_ENGAGEMENT_TTL_SEC,
  probeEngagementRedisKey,
  probeTopicCooldownRedisKey,
} from './probe-fatigue.util';

/**
 * SBA β-5 — ProbePriorityCron (Layer 6).
 *
 * Каждые 15 минут:
 *   1. Пересчитывает engagement_rate per-user (отвечено за 30д / отправлено
 *      за 30д) и выставляет gauge `probe_recipient_engagement_rate{user_id}`.
 *   2. Помечает истёкшие ProbeEvent (`expiresAt < now` AND status ∈
 *      pending | queued_digest | routed_to_digest — L-2) статусом 'expired'
 *      (+ метрика probe_expired_total).
 *
 * Cron-выражение в декораторе литералом (NestJS @Cron не читает ENV). Если
 * `PROBE_PRIORITY_REFRESH_CRON` отличается — заменить декоратор.
 */
@Injectable()
export class ProbePriorityCron {
  private readonly logger = new Logger(ProbePriorityCron.name);
  private static readonly LOOKBACK_DAYS = 30;
  private static readonly USER_LIMIT = 500;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(CoreQueueService) private readonly queue: CoreQueueService,
  ) {}

  @Cron('*/15 * * * *')
  async sweep(): Promise<void> {
    try {
      const now = new Date();
      const cutoff = new Date(
        now.getTime() - ProbePriorityCron.LOOKBACK_DAYS * 24 * 3600 * 1000,
      );

      // 1. Истёкшие ProbeEvent → expired.
      // SBA β-5 closing-loop (sub-TZ 2026-05-23): дополнительно фильтруем
      // probe'ы, у которых dispatchedNotificationId уже отвечен
      // (`Notification.respondedAt IS NOT NULL`). Так мы избегаем гонки
      // «истёк по таймеру, хотя ответ только что пришёл» — закрытый probe
      // не должен пере-помечаться `expired`.
      // L-2 (2026-06-12): digest-статусы (queued_digest / routed_to_digest)
      // тоже стареют — иначе протухший вопрос вечно ждал бы дайджеста.
      const expiredCandidates = await this.prisma.probeEvent.findMany({
        where: {
          status: { in: ['pending', 'queued_digest', 'routed_to_digest'] },
          expiresAt: { lt: now },
        },
        select: {
          id: true,
          dispatchedNotificationId: true,
          // Probe Фаза 5 — для исход-сигнала (ignored) и cooldown темы.
          reason: true,
          tenantId: true,
          contentHash: true,
          // Probe Ф5 re-ask (2026-06-17) — поля для создания переспроса.
          payload: true,
          recipientCandidates: true,
          priority: true,
          emittedByService: true,
        },
      });
      const expirable: ExpirableProbe[] = [];
      for (const cand of expiredCandidates) {
        if (cand.dispatchedNotificationId) {
          const n = await this.prisma.notification.findUnique({
            where: { id: cand.dispatchedNotificationId },
            select: { respondedAt: true },
          });
          if (n?.respondedAt) continue; // уже закрыт пользователем — пропускаем
        }
        expirable.push({
          id: cand.id,
          reason: cand.reason,
          tenantId: cand.tenantId,
          contentHash: cand.contentHash,
          payload: cand.payload,
          recipientCandidates: cand.recipientCandidates,
          priority: cand.priority,
          emittedByService: cand.emittedByService,
        });
      }

      // Probe Ф5 re-ask (2026-06-17, решение владельца Р3): прежде чем закрыть
      // неотвеченный probe как ignored, делаем РОВНО ОДИН переспрос,
      // переформулировав. Учёт попытки — в payload (`reaskCount`,
      // `originalProbeEventId`), без новой колонки. Делим истёкшие на:
      //   - reaskGroup  — первый раз без ответа (reaskCount 0/нет) И флаг ON →
      //                   создаём переформулированный переспрос, исходный
      //                   помечаем terminal `expired` БЕЗ ignored-метрики (он не
      //                   проигнорирован, а переспрошен);
      //   - closeGroup  — переспрос уже был (reaskCount≥1) ИЛИ флаг OFF →
      //                   прежнее поведение: `expired` + outcome=ignored.
      // Оба истекают (incProbeExpired для всех) — переспрошенный исходный тоже
      // «истёк».
      const reaskEnabled = await this.readReaskEnabled();
      const reaskGroup: ExpirableProbe[] = [];
      const closeGroup: ExpirableProbe[] = [];
      for (const e of expirable) {
        const reaskCount = this.readReaskCount(e.payload);
        if (reaskEnabled && reaskCount < 1) reaskGroup.push(e);
        else closeGroup.push(e);
      }

      let expiredCount = 0;
      if (expirable.length > 0) {
        const expired = await this.prisma.probeEvent.updateMany({
          where: {
            id: { in: expirable.map((e) => e.id) },
            // L-2 — те же статусы, что в выборке (идемпотентность гонок).
            status: { in: ['pending', 'queued_digest', 'routed_to_digest'] },
          },
          data: { status: 'expired' },
        });
        expiredCount = expired.count;
        for (let i = 0; i < expired.count; i++) this.metrics.incProbeExpired();
        // Probe Фаза 5 (R10): закрываемый без ответа = исход «ignored» (сигнал
        // калибровки Фазы 2). Тему ставим на cooldown — не доставать человека
        // тем же вопросом в течение probe.topicCooldownHours. ВАЖНО: только
        // closeGroup — переспрошенные (reaskGroup) НЕ ignored.
        await this.recordIgnoredOutcomes(closeGroup);
        // Переспрос: создаём новый pending-probe (переформулировку сделает
        // dispatcher по пометке reaskCount в payload) + enqueue.
        for (const e of reaskGroup) await this.createReask(e);
      }

      // 2. engagement_rate per recipient.
      // Считаем по probe-уведомлениям (eventType='probe.question') за 30 дней.
      // SBA β-5 closing-loop: `respondedAt IS NULL` в знаменателе НЕ
      // вычитаем — знаменатель = «всего отправлено», числитель = «отвечено»
      // (`responseStatus='answered'`, что эквивалентно `respondedAt IS NOT NULL`).
      const sent = await this.prisma.notification.groupBy({
        by: ['recipientUserId'],
        where: {
          eventType: 'probe.question',
          createdAt: { gte: cutoff },
        },
        _count: { _all: true },
        orderBy: { recipientUserId: 'asc' },
        take: ProbePriorityCron.USER_LIMIT,
      });

      let usersDone = 0;
      for (const row of sent) {
        const sentCount = (row as { _count: { _all: number } })._count._all;
        const userId = (row as { recipientUserId: string }).recipientUserId;
        if (sentCount === 0) continue;
        const answeredCount = await this.prisma.notification.count({
          where: {
            recipientUserId: userId,
            eventType: 'probe.question',
            responseStatus: 'answered',
            createdAt: { gte: cutoff },
          },
        });
        const rate = answeredCount / sentCount;
        this.metrics.setProbeRecipientEngagementRate({ userId, rate });
        // Probe Фаза 5 — снимок engagement в Redis: filterByRateLimit режет
        // бюджет низко-отзывчивым (adaptive fatigue). Best-effort.
        try {
          await this.redis.client.set(
            probeEngagementRedisKey(userId),
            String(rate),
            'EX',
            PROBE_ENGAGEMENT_TTL_SEC,
          );
        } catch {
          // Redis down — adaptive просто не применится (graceful).
        }
        usersDone += 1;
      }

      this.logger.debug(
        { expiredCount, users: usersDone },
        'probe-priority: sweep завершён',
      );
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'probe-priority: ошибка прохода — пропускаю',
      );
    }
  }

  /**
   * Probe Фаза 5 — для каждого истёкшего без ответа probe:
   *   - метрика `probe_outcome_total{outcome=ignored, reason}` (калибровка Фазы 2);
   *   - cooldown темы (`contentHash`) в Redis на `probe.topicCooldownHours` —
   *     не доставать человека тем же вопросом сразу после игнора.
   * Best-effort: ошибки Redis/настроек не валят sweep.
   */
  private async recordIgnoredOutcomes(
    expired: ExpirableProbe[],
  ): Promise<void> {
    if (expired.length === 0) return;
    for (const e of expired) {
      this.metrics.incProbeOutcome({ outcome: 'ignored', reason: e.reason });
    }
    try {
      const cooldownHours = await this.cfg.getDynamic<number>(
        'probe.topicCooldownHours',
        undefined,
        48,
      );
      const ttlSec = Math.max(1, Math.round(cooldownHours * 3600));
      for (const e of expired) {
        try {
          await this.redis.client.set(
            probeTopicCooldownRedisKey(e.tenantId, e.contentHash),
            '1',
            'EX',
            ttlSec,
          );
        } catch {
          // Redis down — cooldown просто не применится (graceful).
        }
      }
    } catch {
      // настройка недоступна — пропускаем cooldown.
    }
  }

  /**
   * Probe Ф5 re-ask (2026-06-17) — флаг `probe.reaskEnabled` (AdminSetting,
   * тип А, дефолт ON). getDynamic может упасть (БД/Redis) → ON (паттерн
   * остальных probe-крутилок), чтобы переспрос работал по умолчанию.
   */
  private async readReaskEnabled(): Promise<boolean> {
    try {
      return await this.cfg.getDynamic<boolean>(
        'probe.reaskEnabled',
        undefined,
        true,
      );
    } catch {
      return true;
    }
  }

  /** Текущее число переспросов из payload (`reaskCount`), дефолт 0. */
  private readReaskCount(payload: Prisma.JsonValue): number {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const raw = (payload as Record<string, unknown>).reaskCount;
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (Number.isFinite(n)) return n;
    }
    return 0;
  }

  /**
   * Probe Ф5 re-ask (2026-06-17) — создать переспрос истёкшего probe.
   *
   * Новый `ProbeEvent` (status='pending') наследует reason / получателей /
   * contentHash / priority / emittedByService исходного; в payload — пометка
   * `reaskCount=1` + `originalProbeEventId` (по ней dispatcher переформулирует
   * вопрос мягко, со ссылкой на прошлый). Сразу enqueue в dispatcher.
   *
   * Переспрос создаётся НАПРЯМУЮ здесь (минуя `ProbeService.suggest`), что
   * сознательно обходит suggest-гейты — в т.ч. topic-cooldown: переспрос
   * порождён системой (а не новым специалистом), глушить его cooldown'ом нельзя.
   * Best-effort: ошибка создания/enqueue одного переспроса не валит весь sweep.
   */
  private async createReask(src: ExpirableProbe): Promise<void> {
    try {
      const basePayload =
        src.payload &&
        typeof src.payload === 'object' &&
        !Array.isArray(src.payload)
          ? (src.payload as Record<string, unknown>)
          : {};
      const reaskPayload: Prisma.InputJsonValue = {
        ...basePayload,
        reaskCount: 1,
        originalProbeEventId: src.id,
      };
      const reask = await this.prisma.probeEvent.create({
        data: {
          tenantId: src.tenantId,
          emittedByService: src.emittedByService,
          reason: src.reason,
          payload: reaskPayload,
          recipientCandidates: [...src.recipientCandidates],
          contentHash: src.contentHash,
          priority: src.priority,
          status: 'pending',
          expiresAt: this.computeExpiresAt(),
        },
      });
      this.metrics.incProbeEvent({
        emittedByService: src.emittedByService,
        reason: src.reason,
        status: 'pending',
      });
      await this.queue.enqueueProbeEvent({ probeEventId: reask.id });
      this.logger.log(
        `probe re-ask: создан переспрос id=${reask.id} (исходный=${src.id} reason=${src.reason})`,
      );
    } catch (err) {
      this.logger.warn(
        {
          originalProbeEventId: src.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'probe-priority: createReask упал — переспрос не создан (исходный уже expired)',
      );
    }
  }

  /**
   * Срок жизни переспроса (как у pending в ProbeService): now + probe.expiryDays.
   * Считаем по той же крутилке, что и основной probe-путь — единый контракт.
   */
  private computeExpiresAt(): Date {
    return new Date(Date.now() + this.cfg.probe.expiryDays * 24 * 3600 * 1000);
  }
}

/**
 * Probe Ф5 re-ask (2026-06-17) — поля истёкшего probe, которых достаточно
 * и для ignored-исхода/cooldown, и для создания переспроса.
 */
interface ExpirableProbe {
  id: string;
  reason: string;
  tenantId: string;
  contentHash: string;
  payload: Prisma.JsonValue;
  recipientCandidates: string[];
  priority: number;
  emittedByService: string;
}
