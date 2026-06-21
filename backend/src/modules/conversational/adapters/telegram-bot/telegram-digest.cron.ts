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
  localDayBoundsUtc,
} from '../../../operations/utils/local-date';
import { HolidayService } from '../../../tracker/services/holiday.service';
import { PersonLeaveService } from '../../../tracker/services/person-leave.service';
import { ConversationalService } from '../../conversational.service';

import {
  type TelegramDigestPayload,
  type TelegramDigestSprintBlock,
  TelegramTaskParserService,
} from './telegram-task-parser.service';

@Injectable()
export class TelegramDigestCron {
  private readonly logger = new Logger(TelegramDigestCron.name);

  static readonly MAX_USERS_PER_RUN = 5_000;

  static readonly MAX_PER_SECTION = 12;

  static readonly DEDUP_KEY_PREFIX = 'telegram_digest';
  static readonly DEDUP_TTL_SEC = 25 * 3600;

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
    @Inject(HolidayService) private readonly holiday: HolidayService,
    @Inject(PersonLeaveService) private readonly personLeave: PersonLeaveService,
  ) {}

  @Cron('0 * * * *')
  async digestTick(): Promise<void> {
    try {
      const stats = await this.run();
      this.logger.debug(stats, 'telegram-digest-cron: цикл завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'telegram-digest-cron: непойманная ошибка',
      );
    }
  }

  async run(now: Date = new Date()): Promise<{
    candidates: number;
    sent: number;
    empty: number;
    deduped: number;
    errors: number;
    skippedHour: number;
    skippedNonWorking: number;
  }> {
    const digestHourLocal = await this.resolveDigestHourLocal();
    const skipNonWorkingDays = await this.cfg.getDynamic<boolean>(
      'daily-checkin.skipNonWorkingDays',
      undefined,
      true,
    );
    const skipHolidays = await this.cfg.getDynamic<boolean>(
      'daily-checkin.skipHolidays',
      undefined,
      true,
    );

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
        skippedNonWorking: 0,
      };
    }

    const personRows = await this.prisma.person.findMany({
      where: {
        deletedAt: null,
        userId: { in: bindings.map((b) => b.userId) },
      },
      select: { id: true, userId: true, tenantId: true, timezone: true, workingDays: true },
    });
    const timezoneByKey = new Map<string, string | null>();
    const personMetaByKey = new Map<string, { personId: string; workingDays: number[] }>();
    for (const p of personRows) {
      if (!p.userId) continue;
      timezoneByKey.set(`${p.userId}:${p.tenantId}`, p.timezone);
      personMetaByKey.set(`${p.userId}:${p.tenantId}`, {
        personId: p.id,
        workingDays: p.workingDays ?? [],
      });
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

    let sent = 0;
    let empty = 0;
    let deduped = 0;
    let errors = 0;
    let skippedHour = 0;
    let skippedNonWorking = 0;

    for (const binding of bindings) {
      const userId = binding.userId;
      const tenantId = binding.channel.tenantId ?? membershipByUser.get(userId) ?? null;
      if (!tenantId) {
        skippedHour++;
        continue;
      }
      const tenantTop = tenantTopOf(tenantId);
      const tz = timezoneByKey.get(`${userId}:${tenantId}`) ?? null;
      const localHour = getLocalHour(now, tz);
      const localDate = getLocalDate(now, tz);

      if (localHour !== digestHourLocal) {
        skippedHour++;
        continue;
      }

      const meta = personMetaByKey.get(`${userId}:${tenantId}`);
      const localDayStart = new Date(`${localDate}T00:00:00.000Z`);
      const { dayOfWeek } = localDayBoundsUtc(now, tz);
      const workingDays = meta && meta.workingDays.length ? meta.workingDays : [1, 2, 3, 4, 5];
      if (skipNonWorkingDays && !workingDays.includes(dayOfWeek)) {
        skippedNonWorking++;
        this.metrics.incTelegramDigestSent({ tenantTop, result: 'skipped_non_working' });
        continue;
      }
      if (skipHolidays && (await this.holiday.isHoliday({ tenantId, date: localDayStart }))) {
        skippedNonWorking++;
        this.metrics.incTelegramDigestSent({ tenantTop, result: 'skipped_non_working' });
        continue;
      }
      if (
        meta?.personId &&
        (await this.personLeave.isOnLeave({
          tenantId,
          personId: meta.personId,
          date: localDayStart,
        }))
      ) {
        skippedNonWorking++;
        this.metrics.incTelegramDigestSent({ tenantTop, result: 'skipped_non_working' });
        continue;
      }

      const dedupKey = `${TelegramDigestCron.DEDUP_KEY_PREFIX}:${userId}:${tenantId}:${localDate}`;

      try {
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
          payload.urgentToday.length + payload.inProgress.length + payload.overdue.length;
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
          priorityTier: 1,
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
      skippedNonWorking,
    };
  }

  private async resolveDigestHourLocal(): Promise<number> {
    const parsed = await this.cfg.getDynamic<number>(
      'conversational.telegramDigestHourLocal',
      'TELEGRAM_DIGEST_HOUR_LOCAL',
      TelegramDigestCron.DEFAULT_DIGEST_HOUR_LOCAL,
    );
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 23) {
      this.logger.warn(
        { raw: parsed },
        'telegram-digest-cron: TELEGRAM_DIGEST_HOUR_LOCAL невалиден, fallback 9',
      );
      return TelegramDigestCron.DEFAULT_DIGEST_HOUR_LOCAL;
    }
    return parsed;
  }

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

    let sprint: TelegramDigestSprintBlock | undefined;
    try {
      sprint =
        (await this.collectSprintBlock({
          tenantId: args.tenantId,
          userId: args.userId,
          now,
        })) ?? undefined;
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          userId: args.userId,
          err: err instanceof Error ? err.message : String(err),
        },
        'telegram-digest-cron: sprint-блок упал — пропускаем',
      );
      sprint = undefined;
    }

    return {
      urgentToday: urgentRows.map((i) => issueSummary(i, now)),
      inProgress: inProgressRows.map((i) => issueSummary(i, now)),
      overdue: overdueRows.map((i) => issueSummary(i, now)),
      ...(sprint ? { sprint } : {}),
    };
  }

  private async collectSprintBlock(args: {
    tenantId: string;
    userId: string;
    now: Date;
  }): Promise<TelegramDigestSprintBlock | null> {
    const cycleAssignments = await this.prisma.issue.findMany({
      where: {
        tenantId: args.tenantId,
        deletedAt: null,
        archivedAt: null,
        assignees: { some: { userId: args.userId } },
        cycleId: { not: null },
        cycle: { completedAt: null },
      },
      select: { cycleId: true },
      take: 500,
    });
    if (cycleAssignments.length === 0) return null;

    const countByCycle = new Map<string, number>();
    for (const row of cycleAssignments) {
      if (!row.cycleId) continue;
      countByCycle.set(row.cycleId, (countByCycle.get(row.cycleId) ?? 0) + 1);
    }
    if (countByCycle.size === 0) return null;
    const topCycleId = [...countByCycle.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!topCycleId) return null;

    const threeDaysAgo = new Date(args.now.getTime() - 3 * 24 * 3600 * 1000);
    const twentyFourHoursAgo = new Date(args.now.getTime() - 24 * 3600 * 1000);

    const [cycle, signalHints, actionHint, recentWin, staleCount] = await Promise.all([
      this.prisma.cycle.findUnique({
        where: { id: topCycleId },
        select: { id: true, name: true, description: true, completedAt: true },
      }),
      this.prisma.sprintHint.findMany({
        where: {
          tenantId: args.tenantId,
          cycleId: topCycleId,
          status: 'active',
          kind: {
            in: [
              'due_date_at_risk',
              'no_recent_mentions',
              'recurring_carry_over',
              'conflicts_with_goal',
            ],
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: 3,
        select: { id: true, title: true, kind: true },
      }),
      this.prisma.sprintHint.findFirst({
        where: {
          tenantId: args.tenantId,
          cycleId: topCycleId,
          status: 'active',
          kind: {
            in: ['no_due_date', 'no_assignee', 'no_description'],
          },
        },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, title: true },
      }),
      this.prisma.issue.findFirst({
        where: {
          tenantId: args.tenantId,
          deletedAt: null,
          archivedAt: null,
          cycleId: topCycleId,
          assignees: { some: { userId: args.userId } },
          completedAt: { gte: twentyFourHoursAgo },
        },
        orderBy: { completedAt: 'desc' },
        select: { identifier: true, title: true },
      }),
      this.prisma.issue.count({
        where: {
          tenantId: args.tenantId,
          deletedAt: null,
          archivedAt: null,
          cycleId: topCycleId,
          assignees: { some: { userId: args.userId } },
          updatedAt: { lt: threeDaysAgo },
          state: { category: { notIn: ['completed', 'cancelled'] } },
        },
      }),
    ]);

    if (!cycle) return null;
    if (cycle.completedAt !== null) return null;

    const signals: string[] = signalHints.map((h) => h.title);
    if (signals.length < 3 && staleCount > 0) {
      signals.push(`${staleCount} ${pluralizeIssues(staleCount)} без активности >3 дней`);
    }

    const winLabel = recentWin ? `${recentWin.identifier} «${recentWin.title}»` : null;
    const actionLabel = actionHint ? actionHint.title : null;

    return {
      cycleName: cycle.name,
      hypothesisText: cycle.description?.trim() ? cycle.description.trim() : null,
      signals,
      win: winLabel,
      nextAction: actionLabel,
    };
  }
}

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

function pluralizeIssues(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'задач';
  if (mod10 === 1) return 'задача';
  if (mod10 >= 2 && mod10 <= 4) return 'задачи';
  return 'задач';
}
