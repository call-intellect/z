import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { DailyDigestService } from '../services/daily-digest.service';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

@Injectable()
export class OperationsDailyDigestCron {
  private readonly logger = new Logger(OperationsDailyDigestCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(DailyDigestService)
    private readonly digestService: DailyDigestService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 6 * * *', { timeZone: 'Europe/Moscow' })
  async run(): Promise<void> {
    const enabled = await this.cfg.getDynamic<boolean>(
      'operations.daily_digest.enabled',
      'COO_DAILY_DIGEST_ENABLED',
      true,
    );
    if (!enabled) {
      this.logger.debug(
        'operations-daily-digest.cron: operations.daily_digest.enabled=false, skip',
      );
      return;
    }

    const now = new Date();
    try {
      const stats = await this.runOnce({ now });
      this.logger.log(
        stats,
        'operations-daily-digest.cron: проход завершён',
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'operations-daily-digest.cron: непойманная ошибка',
      );
    }
  }

  async runOnce(args: { now: Date }): Promise<{
    orgsProcessed: number;
    digestsGenerated: number;
    digestsSkippedAlreadyExists: number;
    notificationsSent: number;
    errors: number;
  }> {
    const dateLocal = yesterdayInMoscow(args.now);

    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
      take: 5_000,
    });

    let digestsGenerated = 0;
    let digestsSkippedAlreadyExists = 0;
    let notificationsSent = 0;
    let errors = 0;

    for (const org of orgs) {
      const tenantTop = resolveOperationsTenantTop(org.id);

      const existing = await this.digestService.getStored({
        tenantId: org.id,
        dateLocal,
      });

      let digestId: string;
      let shortSummary: string | null;
      let alreadyDelivered: string | null;
      if (existing) {
        digestsSkippedAlreadyExists++;
        digestId = existing.id;
        shortSummary = existing.shortSummary;
        alreadyDelivered = existing.deliveredAt;
      } else {
        try {
          const digest = await this.digestService.getOrGenerate({
            tenantId: org.id,
            dateLocal,
          });
          digestsGenerated++;
          digestId = digest.id;
          shortSummary = digest.shortSummary;
          alreadyDelivered = digest.deliveredAt;
        } catch (err) {
          errors++;
          this.metrics.incCooDailyDigestFailed({
            tenantTop,
            reason: 'exception',
          });
          this.logger.warn(
            {
              tenantId: org.id,
              dateLocal,
              err: err instanceof Error ? err.message : String(err),
            },
            'operations-daily-digest.cron: ошибка генерации',
          );
          continue;
        }
      }

      if (alreadyDelivered === null) {
        try {
          const sent = await this.notifyRecipients({
            tenantId: org.id,
            digestId,
            dateLocal,
            shortSummary,
            tenantTop,
          });
          notificationsSent += sent;
          if (sent > 0) {
            await this.digestService.markDelivered({
              tenantId: org.id,
              dateLocal,
            });
          }
        } catch (err) {
          errors++;
          this.metrics.incCooDailyDigestFailed({
            tenantTop,
            reason: 'notify_failed',
          });
          this.logger.warn(
            {
              tenantId: org.id,
              dateLocal,
              err: err instanceof Error ? err.message : String(err),
            },
            'operations-daily-digest.cron: ошибка отправки',
          );
        }
      }
    }

    return {
      orgsProcessed: orgs.length,
      digestsGenerated,
      digestsSkippedAlreadyExists,
      notificationsSent,
      errors,
    };
  }

  private async notifyRecipients(args: {
    tenantId: string;
    digestId: string;
    dateLocal: string;
    shortSummary: string | null;
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

    const title = `День компании за ${args.dateLocal}`;
    const body =
      args.shortSummary ??
      'Готов «День компании» за вчера. Откройте главный экран.';
    let safeBody = body.length > 2000 ? body.slice(0, 1999) + '…' : body;
    try {
      const customersLine = await this.digestService.buildCustomersAtRiskLine({
        tenantId: args.tenantId,
      });
      if (customersLine) safeBody = `${safeBody}${customersLine}`;
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'operations-daily-digest.cron: секция «Клиенты под риском» упала — пропускаю',
      );
    }
    const actionUrl = '/dashboard';

    let sent = 0;
    for (const m of memberships) {
      try {
        const pendingLine = await this.digestService.buildPendingActionsLine({
          tenantId: args.tenantId,
          userId: m.userId,
        });
        const bodyWithPending = pendingLine ? `${safeBody}${pendingLine}` : safeBody;
        await this.conversational.sendNotification({
          tenantId: args.tenantId,
          recipientUserId: m.userId,
          eventType: 'operations.daily_digest',
          payload: {
            digestId: args.digestId,
            dateLocal: args.dateLocal,
            title,
            body: bodyWithPending,
            actionUrl,
          },
          dataClass: 'internal',
        });
        sent++;
        this.metrics.incCooDailyDigestDelivered({
          tenantTop: args.tenantTop,
          channel: 'conversational',
        });
      } catch (err) {
        this.metrics.incCooDailyDigestFailed({
          tenantTop: args.tenantTop,
          reason: 'notify_failed',
        });
        this.logger.warn(
          {
            tenantId: args.tenantId,
            userId: m.userId,
            err: err instanceof Error ? err.message : String(err),
          },
          'operations-daily-digest.cron: sendNotification упал',
        );
      }
    }
    return sent;
  }
}

export function yesterdayInMoscow(now: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const todayMsk = fmt.format(now);
  const d = new Date(`${todayMsk}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
