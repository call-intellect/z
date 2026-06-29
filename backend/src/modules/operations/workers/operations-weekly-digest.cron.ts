import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { WeeklyDigestService } from '../services/weekly-digest.service';
import { getLocalDate, getLocalHour } from '../utils/local-date';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

@Injectable()
export class OperationsWeeklyDigestCron {
  private readonly logger = new Logger(OperationsWeeklyDigestCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(WeeklyDigestService)
    private readonly digestService: WeeklyDigestService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 * * * *')
  async run(): Promise<void> {
    if (!this.cfg.betaOps.weeklyDigestEnabled) {
      this.logger.debug('operations-weekly-digest.cron: COO_WEEKLY_DIGEST_ENABLED=false, skip');
      return;
    }
    const now = new Date();
    try {
      const stats = await this.runOnce(now);
      this.logger.debug(stats, 'operations-weekly-digest.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'operations-weekly-digest.cron: непойманная ошибка',
      );
    }
  }

  async runOnce(now: Date): Promise<{
    digestsGenerated: number;
    digestsSkippedAlreadyExists: number;
    digestsSkippedOutsideWindow: number;
    notificationsSent: number;
    errors: number;
  }> {
    const targetHour = this.cfg.betaOps.weeklyDigestLocalHour;
    const targetDay = this.cfg.betaOps.weeklyDigestLocalDay;

    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true, timezone: true },
      take: 5_000,
    });

    let digestsGenerated = 0;
    let digestsSkippedAlreadyExists = 0;
    let digestsSkippedOutsideWindow = 0;
    let notificationsSent = 0;
    let errors = 0;

    for (const org of orgs) {
      const timezone = org.timezone ?? 'Europe/Moscow';
      const localHour = getLocalHour(now, timezone);
      const localDay = getLocalDayOfWeek(now, timezone);

      if (localHour !== targetHour || localDay !== targetDay) {
        digestsSkippedOutsideWindow++;
        continue;
      }

      const todayLocal = getLocalDate(now, timezone);
      const weekStart = shiftDateLocal(todayLocal, -7);
      const weekEnd = shiftDateLocal(weekStart, 4);

      const tenantTop = resolveOperationsTenantTop(org.id);

      const existing = await this.digestService.getStored({
        tenantId: org.id,
        weekStart,
      });
      if (existing) {
        digestsSkippedAlreadyExists++;
        continue;
      }

      try {
        const digest = await this.digestService.getOrGenerate({
          tenantId: org.id,
          weekStart,
          weekEnd,
        });
        digestsGenerated++;
        notificationsSent += await this.notifyRecipients({
          tenantId: org.id,
          digestId: digest.id,
          weekStart,
          weekEnd,
          tenantTop,
        });
      } catch (err) {
        errors++;
        this.metrics.incCooWeeklyDigestFailed({
          tenantTop,
          reason: 'exception',
        });
        this.logger.warn(
          {
            tenantId: org.id,
            weekStart,
            err: err instanceof Error ? err.message : String(err),
          },
          'operations-weekly-digest.cron: ошибка генерации/отправки',
        );
      }
    }

    return {
      digestsGenerated,
      digestsSkippedAlreadyExists,
      digestsSkippedOutsideWindow,
      notificationsSent,
      errors,
    };
  }

  private async notifyRecipients(args: {
    tenantId: string;
    digestId: string;
    weekStart: string;
    weekEnd: string;
    tenantTop: string;
  }): Promise<number> {
    const memberships = await this.prisma.membership.findMany({
      where: {
        orgId: args.tenantId,
        role: { in: ['owner', 'coo'] },
      },
      select: { userId: true },
    });
    if (memberships.length === 0) return 0;

    const title = `Недельная сводка операционного директора ${args.weekStart} — ${args.weekEnd}`;
    const body =
      'Готов еженедельный обзор: температура команды, повторяющиеся блокеры, цели и висящие решения. Откройте «Недельную сводку» в панели операций.';
    const actionUrl = `/dashboard/operations/weekly?weekStart=${args.weekStart}`;

    let sent = 0;
    for (const m of memberships) {
      try {
        await this.conversational.sendNotification({
          tenantId: args.tenantId,
          recipientUserId: m.userId,
          eventType: 'operations.weekly_digest',
          payload: {
            digestId: args.digestId,
            weekStart: args.weekStart,
            weekEnd: args.weekEnd,
            title,
            body,
            actionUrl,
          },
          dataClass: 'internal',
        });
        sent++;
      } catch (err) {
        this.metrics.incCooWeeklyDigestFailed({
          tenantTop: args.tenantTop,
          reason: 'notify_failed',
        });
        this.logger.warn(
          {
            tenantId: args.tenantId,
            userId: m.userId,
            err: err instanceof Error ? err.message : String(err),
          },
          'operations-weekly-digest.cron: sendNotification упал',
        );
      }
    }
    return sent;
  }
}

function getLocalDayOfWeek(now: Date, timezone: string): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
    });
    const wd = fmt.format(now);
    const map: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    return map[wd] ?? new Date(now).getUTCDay();
  } catch {
    return new Date(now).getUTCDay();
  }
}

function shiftDateLocal(dateLocal: string, days: number): string {
  const d = new Date(`${dateLocal}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
