import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { type Issue, type IssueState } from '@prisma/client';

import { TypedConfigService } from '../../../../common/config/index';
import { BusinessMetricsService } from '../../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { RedisService } from '../../../../common/redis/redis.service';
import { tenantTopOf } from '../../../dialog-layer/utils/tenant-top';
import {
  getLocalDate,
  getLocalHour,
} from '../../../operations/utils/local-date';
import { ConversationalService } from '../../conversational.service';

import {
  type TelegramDigestPayload,
  TelegramTaskParserService,
} from './telegram-task-parser.service';

/**
 * Wave 3 / Tracker Phase 4 РФ (2026-05-24) — TelegramDigestCron.
 *
 * Утренний дайджест задач для каждого пользователя с активным
 * Telegram-каналом.
 *
 * Wave 3 finishing (2026-05-24): hourly tick + per-user TZ.
 *   - Запуск каждый час `@Cron('0 * * * *')`.
 *   - Для каждого user'а резолвим `Person.timezone` (default `Europe/Moscow`).
 *   - Если локальный час пользователя == `TELEGRAM_DIGEST_HOUR_LOCAL`
 *     (ENV, default 9) → отправляем; иначе тихо пропускаем (без метрики).
 *   - Dedup key теперь по локальной дате (YYYY-MM-DD в TZ user'а), TTL ~25h.
 *
 * Алгоритм:
 *   1. Найти все ChannelBinding с kind=telegram_bot, verifiedAt IS NOT NULL.
 *   2. Для каждого user'а собрать issues по 3 секциям:
 *      - urgentToday: dueDate=сегодня + state.category != completed/cancelled.
 *      - inProgress: assignee=user + state.category='started'.
 *      - overdue: dueDate < сегодня + state.category != completed/cancelled.
 *   3. Если ничего нет → skip (метрика `empty`).
 *   4. LLM `telegram-digest-formulate` → markdown/HTML.
 *   5. Отправить через ConversationalService.sendNotification(
 *        eventType='telegram.digest', preferredChannelKinds=['telegram_bot']).
 *
 * Idempotency: Redis dedup key
 *   `telegram_digest:${userId}:${tenantId}:${YYYY-MM-DD local}` с TTL ~25h
 *   (чуть больше суток — покрывает edge-cases с TZ-shift / DST).
 */
@Injectable()
export class TelegramDigestCron {
  private readonly logger = new Logger(TelegramDigestCron.name);

  /** Максимум пользователей в одной обработке (защита от runaway). */
  static readonly MAX_USERS_PER_RUN = 5_000;

  /** Сколько issues максимум в каждой секции для LLM-промпта. */
  static readonly MAX_PER_SECTION = 12;

  /** Redis key prefix + TTL для idempotency. */
  static readonly DEDUP_KEY_PREFIX = 'telegram_digest';
  /** ~25 часов — покрывает TZ-shift и DST-переходы. */
  static readonly DEDUP_TTL_SEC = 25 * 3600;

  /** Default локальный час отправки дайджеста (если ENV не задан). */
  static readonly DEFAULT_DIGEST_HOUR_LOCAL = 9;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(TelegramTaskParserService)
    private readonly parser: TelegramTaskParserService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  /**
   * Главный cron. Запуск каждый час; внутри — фильтр по локальному часу
   * каждого user'а (`Person.timezone`).
   */
  @Cron('0 * * * *')
  async digestTick(): Promise<void> {
    try {
      const stats = await this.run();
      this.logger.log(
        stats,
        'telegram-digest-cron: цикл завершён',
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'telegram-digest-cron: непойманная ошибка',
      );
    }
  }

  /**
   * Публичный метод для тестов / ручного триггера. Опц. `now` — для unit-тестов
   * с конкретным временем.
   */
  async run(now: Date = new Date()): Promise<{
    candidates: number;
    sent: number;
    empty: number;
    deduped: number;
    errors: number;
    skippedHour: number;
  }> {
    const digestHourLocal = this.resolveDigestHourLocal();

    // 1. Берём binding'и в активных Telegram-каналах.
    const bindings = await this.prisma.channelBinding.findMany({
      where: {
        verifiedAt: { not: null },
        channel: { kind: 'telegram_bot', status: 'active' },
      },
      include: { channel: true },
      take: TelegramDigestCron.MAX_USERS_PER_RUN,
    });
    if (bindings.length === 0) {
      return {
        candidates: 0,
        sent: 0,
        empty: 0,
        deduped: 0,
        errors: 0,
        skippedHour: 0,
      };
    }

    // 2. Batch-резолв Person.timezone для всех (userId, tenantId) пар.
    //    Person привязан 1:1 к User в рамках tenant'а (Person.userId).
    //    Если Person нет — fallback Europe/Moscow в getLocalHour.
    const personRows = await this.prisma.person.findMany({
      where: {
        deletedAt: null,
        userId: { in: bindings.map((b) => b.userId) },
      },
      select: { userId: true, tenantId: true, timezone: true },
    });
    const timezoneByKey = new Map<string, string | null>();
    for (const p of personRows) {
      if (!p.userId) continue;
      timezoneByKey.set(`${p.userId}:${p.tenantId}`, p.timezone);
    }

    // β-9: для глобального канала (`Channel.tenantId IS NULL`) tenantId
    // нужно резолвить через `Membership.findFirst({ userId })` (принцип 4
    // — один пользователь = одна Org). Делаем batch-резолв заранее.
    const userIdsWithoutTenant = bindings
      .filter((b) => b.channel.tenantId === null)
      .map((b) => b.userId);
    const membershipByUser = new Map<string, string>();
    if (userIdsWithoutTenant.length > 0) {
      const memberships = await this.prisma.membership.findMany({
        where: { userId: { in: userIdsWithoutTenant } },
        orderBy: { joinedAt: 'asc' },
        select: { userId: true, orgId: true },
      });
      for (const m of memberships) {
        // Берём первый по joinedAt — игнорируем последующие (один user = одна Org).
        if (!membershipByUser.has(m.userId)) {
          membershipByUser.set(m.userId, m.orgId);
        }
      }
    }

    let sent = 0;
    let empty = 0;
    let deduped = 0;
    let errors = 0;
    let skippedHour = 0;

    for (const binding of bindings) {
      const userId = binding.userId;
      // β-9: per-tenant канал — `binding.channel.tenantId`; глобальный —
      // резолвим через membership. Если ничего не нашли — пропускаем
      // (digest не может идти «в воздух», без Org-контекста).
      const tenantId =
        binding.channel.tenantId ?? membershipByUser.get(userId) ?? null;
      if (!tenantId) {
        skippedHour++; // считаем как тихий skip (без отдельной метрики)
        continue;
      }
      const tenantTop = tenantTopOf(tenantId);
      const tz = timezoneByKey.get(`${userId}:${tenantId}`) ?? null;
      const localHour = getLocalHour(now, tz);
      const localDate = getLocalDate(now, tz);

      // Час пользователя ≠ настроенный → тихий skip без метрики
      // (метрика считает только реальные tick'и отправки/dedup/empty/error).
      if (localHour !== digestHourLocal) {
        skippedHour++;
        continue;
      }

      const dedupKey = `${TelegramDigestCron.DEDUP_KEY_PREFIX}:${userId}:${tenantId}:${localDate}`;

      try {
        // Dedup: SET NX EX. Если уже выставлено — skip.
        const setResult = await this.redis.client.set(
          dedupKey,
          '1',
          'EX',
          TelegramDigestCron.DEDUP_TTL_SEC,
          'NX',
        );
        if (setResult !== 'OK') {
          deduped++;
          this.metrics.incTelegramDigestSent({
            tenantTop,
            result: 'dedup_skip',
          });
          continue;
        }

        const payload = await this.collectIssuesPayload({
          tenantId,
          userId,
        });
        const total =
          payload.urgentToday.length +
          payload.inProgress.length +
          payload.overdue.length;
        if (total === 0) {
          empty++;
          this.metrics.incTelegramDigestSent({ tenantTop, result: 'empty' });
          continue;
        }

        const markdown = await this.parser.formulateDigest({
          tenantId,
          userId,
          issuesPayload: payload,
        });
        if (!markdown) {
          empty++;
          this.metrics.incTelegramDigestSent({ tenantTop, result: 'empty' });
          continue;
        }

        // Отправляем как уведомление system.message — оно умеет
        // routeиться в Telegram (см. EVENT_TYPE_CHANNEL_POLICY).
        await this.conversational.sendNotification({
          tenantId,
          recipientUserId: userId,
          eventType: 'system.message',
          payload: {
            title: '☀️ Доброе утро!',
            body: markdown,
          },
          dataClass: 'internal',
          preferredChannelKinds: ['telegram_bot'],
          critical: false,
        });
        this.metrics.incTelegramDigestSent({ tenantTop, result: 'sent' });
        sent++;
      } catch (err) {
        errors++;
        this.metrics.incTelegramDigestSent({ tenantTop, result: 'error' });
        this.logger.warn(
          {
            tenantId,
            userId,
            err: err instanceof Error ? err.message : String(err),
          },
          'telegram-digest-cron: пользователь — error, продолжаем',
        );
      }
    }

    return {
      candidates: bindings.length,
      sent,
      empty,
      deduped,
      errors,
      skippedHour,
    };
  }

  /**
   * Резолвит локальный час отправки дайджеста из ENV
   * `TELEGRAM_DIGEST_HOUR_LOCAL`. Невалидное значение / NaN → default 9.
   * Паттерн совпадает с `GOAL_ALIGNMENT_LOW_ENABLED` (process.env напрямую).
   */
  private resolveDigestHourLocal(): number {
    const raw = process.env.TELEGRAM_DIGEST_HOUR_LOCAL;
    if (!raw) return TelegramDigestCron.DEFAULT_DIGEST_HOUR_LOCAL;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 23) {
      this.logger.warn(
        { raw },
        'telegram-digest-cron: TELEGRAM_DIGEST_HOUR_LOCAL невалиден, fallback 9',
      );
      return TelegramDigestCron.DEFAULT_DIGEST_HOUR_LOCAL;
    }
    return parsed;
  }

  /**
   * Собирает 3 секции issue'ов для пользователя.
   */
  private async collectIssuesPayload(args: {
    tenantId: string;
    userId: string;
  }): Promise<TelegramDigestPayload> {
    const now = new Date();
    const startOfDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const endOfDay = new Date(startOfDay.getTime() + 24 * 3600 * 1000);

    const baseWhere = {
      tenantId: args.tenantId,
      deletedAt: null,
      archivedAt: null,
      assignees: { some: { userId: args.userId } },
    } as const;

    const [urgentRows, inProgressRows, overdueRows] = await Promise.all([
      this.prisma.issue.findMany({
        where: {
          ...baseWhere,
          dueDate: { gte: startOfDay, lt: endOfDay },
          state: { category: { notIn: ['completed', 'cancelled'] } },
        },
        include: { state: true },
        take: TelegramDigestCron.MAX_PER_SECTION,
        orderBy: { dueDate: 'asc' },
      }),
      this.prisma.issue.findMany({
        where: {
          ...baseWhere,
          state: { category: 'started' },
        },
        include: { state: true },
        take: TelegramDigestCron.MAX_PER_SECTION,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.issue.findMany({
        where: {
          ...baseWhere,
          dueDate: { lt: startOfDay },
          state: { category: { notIn: ['completed', 'cancelled'] } },
        },
        include: { state: true },
        take: TelegramDigestCron.MAX_PER_SECTION,
        orderBy: { dueDate: 'asc' },
      }),
    ]);

    return {
      urgentToday: urgentRows.map((i) => issueSummary(i, now)),
      inProgress: inProgressRows.map((i) => issueSummary(i, now)),
      overdue: overdueRows.map((i) => issueSummary(i, now)),
    };
  }
}

// ─────────────────────────── private helpers ────────────────────────────

function issueSummary(
  issue: Issue & { state: IssueState | null },
  now: Date,
): { identifier: string; title: string; dueLabel?: string | null; daysOverdue?: number | null } {
  let dueLabel: string | null = null;
  let daysOverdue: number | null = null;
  if (issue.dueDate) {
    const ms = issue.dueDate.getTime() - now.getTime();
    const days = Math.floor(ms / (24 * 3600 * 1000));
    if (days >= 0) {
      dueLabel = `срок ${issue.dueDate.toISOString().slice(0, 10)}`;
    } else {
      daysOverdue = Math.abs(days);
      dueLabel = `просрочен на ${daysOverdue} дн.`;
    }
  }
  return {
    identifier: issue.identifier,
    title: issue.title,
    ...(dueLabel ? { dueLabel } : {}),
    ...(daysOverdue !== null ? { daysOverdue } : {}),
  };
}

// Помечаем typed-config как использованный — оставляем DI для будущих ENV.
void TypedConfigService;
