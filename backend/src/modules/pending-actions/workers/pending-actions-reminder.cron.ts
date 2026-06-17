import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/typed-config.service';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { ChannelBindingPreferencesSchema } from '../../conversational/types/preferences.schema';
import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';
import { getLocalDate, getLocalHour, isWithinQuietHours } from '../../operations/utils/local-date';
import type { PendingActionSource } from '../services/pending-actions.service';
import { PendingActionsService } from '../services/pending-actions.service';

@Injectable()
export class PendingActionsReminderCron {
  private readonly logger = new Logger(PendingActionsReminderCron.name);

  static readonly MAX_USERS_PER_RUN = 5_000;

  static readonly LIST_LIMIT = 5;

  static readonly DEDUP_KEY_PREFIX = 'pending_reminder';
  static readonly DEDUP_TTL_SEC = 4 * 3600;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(PendingActionsService)
    private readonly pendingActions: PendingActionsService,
    @Inject(TypedConfigService)
    private readonly cfg: TypedConfigService,
  ) {}

  @Cron('0 * * * *')
  async reminderTick(): Promise<void> {
    try {
      const stats = await this.run();
      this.logger.debug(stats, 'pending-actions-reminder: цикл завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'pending-actions-reminder: непойманная ошибка',
      );
    }
  }

  async run(now: Date = new Date()): Promise<{
    candidates: number;
    sent: number;
    empty: number;
    deduped: number;
    errors: number;
    skippedSlot: number;
    skippedQuiet: number;
  }> {
    const bindings = await this.prisma.channelBinding.findMany({
      where: {
        verifiedAt: { not: null },
        channel: { kind: 'telegram_bot', status: 'active' },
      },
      include: { channel: true },
      take: PendingActionsReminderCron.MAX_USERS_PER_RUN,
    });
    if (bindings.length === 0) {
      return {
        candidates: 0,
        sent: 0,
        empty: 0,
        deduped: 0,
        errors: 0,
        skippedSlot: 0,
        skippedQuiet: 0,
      };
    }

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
        if (!membershipByUser.has(m.userId)) {
          membershipByUser.set(m.userId, m.orgId);
        }
      }
    }

    const slotHours = buildSlotHours(
      this.cfg.pendingActions.reminderWindowStartHour,
      this.cfg.pendingActions.reminderWindowEndHour,
      this.cfg.pendingActions.reminderStepHours,
    );

    let sent = 0;
    let empty = 0;
    let deduped = 0;
    let errors = 0;
    let skippedSlot = 0;
    let skippedQuiet = 0;

    for (const binding of bindings) {
      const userId = binding.userId;
      const tenantId = binding.channel.tenantId ?? membershipByUser.get(userId) ?? null;
      if (!tenantId) {
        skippedSlot++;
        continue;
      }
      const tenantTop = tenantTopOf(tenantId);
      const tz = timezoneByKey.get(`${userId}:${tenantId}`) ?? null;
      const localHour = getLocalHour(now, tz);

      if (!slotHours.includes(localHour)) {
        skippedSlot++;
        continue;
      }

      const prefs = this.readPreferences(binding.preferences);
      if (prefs.disabledUntil) {
        const until = new Date(prefs.disabledUntil);
        if (Number.isFinite(until.getTime()) && until > now) {
          skippedQuiet++;
          continue;
        }
      }
      if (isWithinQuietHours(now, tz, prefs.quietHours)) {
        skippedQuiet++;
        continue;
      }

      const localDate = getLocalDate(now, tz);
      const dedupKey = `${PendingActionsReminderCron.DEDUP_KEY_PREFIX}:${userId}:${tenantId}:${localDate}:${localHour}`;

      try {
        const setResult = await this.redis.client.set(
          dedupKey,
          '1',
          'EX',
          PendingActionsReminderCron.DEDUP_TTL_SEC,
          'NX',
        );
        if (setResult !== 'OK') {
          deduped++;
          this.metrics.incPendingReminderSent({ tenantTop, result: 'dedup' });
          continue;
        }

        const count = await this.pendingActions.getCount({ tenantId, userId });
        if (count.total === 0) {
          empty++;
          this.metrics.incPendingReminderSent({ tenantTop, result: 'empty' });
          continue;
        }

        const list = await this.pendingActions.getList({
          tenantId,
          userId,
          limit: PendingActionsReminderCron.LIST_LIMIT,
        });
        const urgentCount = list.items.filter((i) => i.severity === 'urgent').length;
        const lines = list.items.map((i) => `${i.severity === 'urgent' ? '🔴 ' : '• '}${i.title}`);
        const actionUrl = '/actions';

        const body = buildReminderBody({
          total: count.total,
          bySource: count.bySource,
          urgentCount,
          lines,
          actionUrl,
        });

        await this.conversational.sendNotification({
          tenantId,
          recipientUserId: userId,
          eventType: 'system.message',
          payload: {
            title: '🔔 Ждёт вашего подтверждения',
            body,
          },
          dataClass: 'internal',
          preferredChannelKinds: ['telegram_bot'],
          critical: false,
        });
        this.metrics.incPendingReminderSent({ tenantTop, result: 'sent' });
        sent++;
      } catch (err) {
        errors++;
        this.metrics.incPendingReminderSent({ tenantTop, result: 'error' });
        this.logger.warn(
          {
            tenantId,
            userId,
            err: err instanceof Error ? err.message : String(err),
          },
          'pending-actions-reminder: пользователь — error, продолжаем',
        );
      }
    }

    return {
      candidates: bindings.length,
      sent,
      empty,
      deduped,
      errors,
      skippedSlot,
      skippedQuiet,
    };
  }

  private readPreferences(raw: unknown): {
    quietHours?: string;
    disabledUntil?: string;
  } {
    if (!raw || typeof raw !== 'object') return {};
    const parsed = ChannelBindingPreferencesSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn('pending-actions-reminder: невалидный preferences-blob — используем дефолт');
      return {};
    }
    return parsed.data;
  }
}

function buildSlotHours(start: number, end: number, step: number): number[] {
  const out: number[] = [];
  for (let h = start; h <= end; h += step) out.push(h);
  return out;
}

const SOURCE_LABEL: Record<PendingActionSource, string> = {
  curation: 'Решения/карточки',
  conflict: 'Конфликты',
  intake: 'Задачи',
  probe: 'Вопросы',
};

function buildReminderBody(args: {
  total: number;
  bySource: Record<PendingActionSource, number>;
  urgentCount: number;
  lines: string[];
  actionUrl: string;
}): string {
  const breakdown = (['curation', 'conflict', 'intake', 'probe'] as PendingActionSource[])
    .map((s) => `${SOURCE_LABEL[s]} — ${args.bySource[s]}`)
    .join(', ');

  const headline =
    args.urgentCount > 0
      ? `Ждёт вашего подтверждения: ${args.total} (срочных — ${args.urgentCount}).`
      : `Ждёт вашего подтверждения: ${args.total}.`;

  const parts: string[] = [headline, breakdown];
  if (args.lines.length > 0) {
    parts.push('', ...args.lines);
  }
  parts.push('', `Открыть: ${args.actionUrl}`);
  return parts.join('\n');
}
