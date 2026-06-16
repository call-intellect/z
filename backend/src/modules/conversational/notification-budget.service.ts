import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getLocalDate, getLocalHour } from '../operations/utils/local-date';

export const DEFAULT_DAILY_BUDGET_PER_PERSON = 5;
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

export interface PersonNotificationPrefs {
  optOutEventTypes?: string[];
  quietHoursStart?: number;
  quietHoursEnd?: number;
}

export function decideQuietHours(localHour: number, start: number, end: number): boolean {
  if (!Number.isFinite(localHour)) return false;
  if (start === end) return false;
  if (start < end) {
    return localHour >= start && localHour < end;
  }
  return localHour >= start || localHour < end;
}

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

    if (prefs.optOutEventTypes && prefs.optOutEventTypes.includes(args.eventType)) {
      this.metrics.incNotificationBudgetBlocked({ reason: 'opted_out' });
      this.metrics.incNotificationDeferredToDigest();
      return { allowed: false, reason: 'opted_out' };
    }

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

    const limit = await this.cfg.getDynamic<number>(
      'notifications.daily_budget.per_person',
      'NOTIFICATIONS_DAILY_BUDGET_PER_PERSON',
      DEFAULT_DAILY_BUDGET_PER_PERSON,
    );
    const dateLocal = getLocalDate(now, person.timezone);

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
        out.optOutEventTypes = (raw['notificationOptOutEventTypes'] as unknown[]).filter(
          (v): v is string => typeof v === 'string',
        );
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

  private bumpTrigger(raw: Prisma.JsonValue, eventType: string): Prisma.InputJsonValue {
    const map: Record<string, number> =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? { ...(raw as Record<string, number>) }
        : {};
    const cur = typeof map[eventType] === 'number' ? map[eventType] : 0;
    map[eventType] = cur + 1;
    return map as Prisma.InputJsonValue;
  }
}
