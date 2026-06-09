import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getLocalDate, getLocalHour } from '../operations/utils/local-date';

/**
 * TZ-1 Фаза 0 (daily-value-engine) — дневной бюджет push-уведомлений на одного
 * Person'а. Главная цель — не заваливать человека пушами: при достижении
 * лимита не-критические push-доставки откладываются (в in_app они всё равно
 * видны, поэтому ничего не теряется молча).
 *
 * Используется `ConversationalService.sendNotification` ПЕРЕД циклом push-
 * доставок. Сам сервис НЕ импортирует ConversationalService (во избежание
 * циклической зависимости DI).
 *
 * Решение `tryConsume`:
 *   1. Резолвим Person (tenantId + recipientUserId). Нет Person (external) →
 *      `{allowed:true}` (бюджет не применяется).
 *   2. `critical===true` ИЛИ `priorityTier===1` → байпас бюджета и тихих часов
 *      (но всё равно увеличиваем счётчик — это «consume-count»).
 *   3. Тихие часы (локальная TZ Person'а) → blocked (reason='quiet_hours'),
 *      если не байпас.
 *   4. Opt-out этого eventType (из Person preferences) → blocked
 *      (reason='opted_out').
 *   5. Бюджет: атомарный upsert ledger'а; если `sentCount >= limit` и не
 *      байпас → blocked (reason='budget_exceeded'); иначе increment и allow.
 */

/** Лимит уведомлений по умолчанию (если AdminSetting/ENV не заданы). */
export const DEFAULT_DAILY_BUDGET_PER_PERSON = 5;
/** Тихие часы по умолчанию: 22:00–08:00 локального времени. */
export const DEFAULT_QUIET_HOURS_START = 22;
export const DEFAULT_QUIET_HOURS_END = 8;

export type BudgetBlockReason = 'budget_exceeded' | 'quiet_hours' | 'opted_out';

export interface TryConsumeArgs {
  tenantId: string;
  recipientUserId: string;
  eventType: string;
  priorityTier?: number;
  critical?: boolean;
}

export interface TryConsumeResult {
  allowed: boolean;
  reason?: BudgetBlockReason;
}

/**
 * Хранилище per-person настроек уведомлений. Денормализовано в
 * `Person.knowledgeProfile` мы НЕ используем — opt-out/quiet-hours живут в
 * `ChannelBinding(in_app).preferences` (см. PATCH /me/notification-preferences).
 * Этот тип — то, что `tryConsume` читает из preferences in_app-binding'а.
 */
export interface PersonNotificationPrefs {
  /** eventType'ы, от которых человек отписался (push не шлём). */
  optOutEventTypes?: string[];
  /** Личное окно тихих часов (час начала 0..23). Перекрывает дефолт. */
  quietHoursStart?: number;
  /** Личное окно тихих часов (час конца 0..23). Перекрывает дефолт. */
  quietHoursEnd?: number;
}

/**
 * Чистое решение «сейчас тихие часы?» по локальному часу и окну. Окно
 * полуоткрытое [start, end). Поддерживает окно через полночь (start > end),
 * например 22..8. start === end → тихих часов нет.
 *
 * Выделено отдельной экспортируемой функцией для unit-тестов без БД/времени.
 */
export function decideQuietHours(
  localHour: number,
  start: number,
  end: number,
): boolean {
  if (!Number.isFinite(localHour)) return false;
  if (start === end) return false;
  if (start < end) {
    return localHour >= start && localHour < end;
  }
  // Окно через полночь, например 22..8.
  return localHour >= start || localHour < end;
}

/**
 * Чистое решение «бюджет превышен?». Байпас (critical/priority1) → никогда
 * не превышен. Выделено для unit-тестов.
 */
export function isOverBudget(
  sentCount: number,
  limit: number,
  critical: boolean,
  priorityTier: number | undefined,
): boolean {
  if (critical) return false;
  if (priorityTier === 1) return false;
  return sentCount >= limit;
}

@Injectable()
export class NotificationBudgetService {
  private readonly logger = new Logger(NotificationBudgetService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async tryConsume(args: TryConsumeArgs): Promise<TryConsumeResult> {
    const critical = args.critical === true;
    const bypass = critical || args.priorityTier === 1;
    const now = new Date();

    // 1. Резолвим Person (tenantId + userId). Нет Person → бюджет не применяется.
    const person = await this.prisma.person.findFirst({
      where: {
        tenantId: args.tenantId,
        userId: args.recipientUserId,
        deletedAt: null,
      },
      select: { id: true, timezone: true },
    });
    if (!person) {
      return { allowed: true };
    }

    const prefs = await this.readPersonPrefs({
      tenantId: args.tenantId,
      userId: args.recipientUserId,
    });

    // 2. Opt-out этого eventType — даже critical/priority1 уважаем явный
    //    отказ человека от этого типа push (in_app всё равно покроет
    //    видимость). Это решение пользователя, не спам-защита.
    if (
      prefs.optOutEventTypes &&
      prefs.optOutEventTypes.includes(args.eventType)
    ) {
      this.metrics.incNotificationBudgetBlocked({ reason: 'opted_out' });
      this.metrics.incNotificationDeferredToDigest();
      return { allowed: false, reason: 'opted_out' };
    }

    // 3. Тихие часы (локальная TZ Person'а), если не байпас.
    if (!bypass) {
      const localHour = getLocalHour(now, person.timezone);
      const start =
        prefs.quietHoursStart ??
        (await this.cfg.getDynamic<number>(
          'notifications.quiet_hours.start',
          'NOTIFICATIONS_QUIET_HOURS_START',
          DEFAULT_QUIET_HOURS_START,
        ));
      const end =
        prefs.quietHoursEnd ??
        (await this.cfg.getDynamic<number>(
          'notifications.quiet_hours.end',
          'NOTIFICATIONS_QUIET_HOURS_END',
          DEFAULT_QUIET_HOURS_END,
        ));
      if (decideQuietHours(localHour, start, end)) {
        this.metrics.incNotificationBudgetBlocked({ reason: 'quiet_hours' });
        this.metrics.incNotificationDeferredToDigest();
        return { allowed: false, reason: 'quiet_hours' };
      }
    }

    // 4. Бюджет: лимит из AdminSetting/ENV/default.
    const limit = await this.cfg.getDynamic<number>(
      'notifications.daily_budget.per_person',
      'NOTIFICATIONS_DAILY_BUDGET_PER_PERSON',
      DEFAULT_DAILY_BUDGET_PER_PERSON,
    );
    const dateLocal = getLocalDate(now, person.timezone);

    // Атомарный учёт через upsert + условный increment в транзакции, чтобы
    // параллельные доставки не пробивали лимит (race-safe).
    const decision = await this.prisma.$transaction(async (tx) => {
      const ledger = await tx.notificationBudgetLedger.upsert({
        where: {
          tenantId_personId_dateLocal: {
            tenantId: args.tenantId,
            personId: person.id,
            dateLocal,
          },
        },
        create: {
          tenantId: args.tenantId,
          personId: person.id,
          dateLocal,
          sentCount: 0,
          byTrigger: {},
        },
        update: {},
        select: { id: true, sentCount: true, byTrigger: true },
      });

      if (isOverBudget(ledger.sentCount, limit, critical, args.priorityTier)) {
        return { allowed: false as const, reason: 'budget_exceeded' as const };
      }

      const byTrigger = this.bumpTrigger(ledger.byTrigger, args.eventType);
      await tx.notificationBudgetLedger.update({
        where: { id: ledger.id },
        data: {
          sentCount: { increment: 1 },
          lastSentAt: now,
          byTrigger,
        },
      });
      return { allowed: true as const };
    });

    if (!decision.allowed) {
      this.metrics.incNotificationBudgetBlocked({ reason: decision.reason });
      this.metrics.incNotificationDeferredToDigest();
      return { allowed: false, reason: decision.reason };
    }

    this.metrics.incNotificationBudgetConsumed({ trigger: args.eventType });
    return { allowed: true };
  }

  /**
   * Читает per-person настройки уведомлений из preferences in_app-binding'а
   * (там их сохраняет PATCH /me/notification-preferences). Ошибки чтения не
   * валят доставку — возвращаем пустые prefs.
   */
  private async readPersonPrefs(args: {
    tenantId: string;
    userId: string;
  }): Promise<PersonNotificationPrefs> {
    try {
      const binding = await this.prisma.channelBinding.findFirst({
        where: {
          userId: args.userId,
          channel: { tenantId: args.tenantId, kind: 'in_app' },
        },
        select: { preferences: true },
      });
      const raw = binding?.preferences as Record<string, unknown> | undefined;
      if (!raw || typeof raw !== 'object') return {};
      const out: PersonNotificationPrefs = {};
      if (Array.isArray(raw['notificationOptOutEventTypes'])) {
        out.optOutEventTypes = (raw['notificationOptOutEventTypes'] as unknown[])
          .filter((v): v is string => typeof v === 'string');
      }
      if (typeof raw['notificationQuietHoursStart'] === 'number') {
        out.quietHoursStart = raw['notificationQuietHoursStart'] as number;
      }
      if (typeof raw['notificationQuietHoursEnd'] === 'number') {
        out.quietHoursEnd = raw['notificationQuietHoursEnd'] as number;
      }
      return out;
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'readPersonPrefs: сбой чтения preferences — продолжаю с дефолтом',
      );
      return {};
    }
  }

  /** Увеличить счётчик eventType в byTrigger-карте (immutable copy). */
  private bumpTrigger(
    raw: Prisma.JsonValue,
    eventType: string,
  ): Prisma.InputJsonValue {
    const map: Record<string, number> =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? { ...(raw as Record<string, number>) }
        : {};
    const cur = typeof map[eventType] === 'number' ? map[eventType] : 0;
    map[eventType] = cur + 1;
    return map as Prisma.InputJsonValue;
  }
}
