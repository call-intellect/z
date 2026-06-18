import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { lastWeekBoundsMsk } from '../../../common/utils/iso-week';
import { ConversationalService } from '../../conversational/conversational.service';
import { resolveAxisTenantTop } from '../../knowledge-core/services/tenant-top';
import { GoalsPulseService } from '../services/goals-pulse.service';

@Injectable()
export class GoalsPulseCron {
  private readonly logger = new Logger(GoalsPulseCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(GoalsPulseService) private readonly pulse: GoalsPulseService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 6 * * 1')
  async runWeekly(): Promise<void> {
    const enabled = await this.cfg.getDynamic<boolean>(
      'goals.pulse.enabled',
      'GOALS_PULSE_ENABLED',
      true,
    );
    if (!enabled) {
      this.logger.debug('goals-pulse.cron: goals.pulse.enabled=false, skip');
      return;
    }

    const deliverToTelegram = await this.cfg.getDynamic<boolean>(
      'goals.pulse.deliver_to_telegram',
      'GOALS_PULSE_DELIVER_TO_TELEGRAM',
      false,
    );

    try {
      const stats = await this.runOnce({ now: new Date(), deliverToTelegram });
      this.logger.debug(stats, 'goals-pulse.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'goals-pulse.cron: непойманная ошибка',
      );
    }
  }

  async runOnce(args: { now: Date; deliverToTelegram: boolean }): Promise<{
    orgsProcessed: number;
    digestsGenerated: number;
    digestsSkippedAlreadyExists: number;
    notificationsSent: number;
    errors: number;
  }> {
    const { weekStart, weekEnd, isoWeek } = lastWeekBoundsMsk(args.now);

    const orgs = await this.listOrgsWithActiveGoals();

    let digestsGenerated = 0;
    let digestsSkippedAlreadyExists = 0;
    let notificationsSent = 0;
    let errors = 0;

    for (const tenantId of orgs) {
      const tenantTop = resolveAxisTenantTop(tenantId);
      try {
        const existing = await this.pulse.getStored({ tenantId, isoWeek });
        const digest =
          existing ??
          (await this.pulse.getOrGenerate({
            tenantId,
            isoWeek,
            weekStart,
            weekEnd,
          }));
        if (existing) digestsSkippedAlreadyExists++;
        else digestsGenerated++;

        if (args.deliverToTelegram && digest.deliveredAt === null) {
          const sent = await this.notifyRecipients({
            tenantId,
            digestId: digest.id,
            isoWeek,
            shortSummary: digest.shortSummary,
            bodyMarkdown: digest.bodyMarkdown,
            tenantTop,
          });
          notificationsSent += sent;
          if (sent > 0) {
            await this.pulse.markDelivered({ tenantId, isoWeek });
          }
        }
      } catch (err) {
        errors++;
        this.metrics.incGoalsPulseFailed({ tenantTop, reason: 'exception' });
        this.logger.warn(
          {
            tenantId,
            isoWeek,
            err: err instanceof Error ? err.message : String(err),
          },
          'goals-pulse.cron: ошибка по Org — продолжаю',
        );
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
    isoWeek: string;
    shortSummary: string | null;
    bodyMarkdown: string;
    tenantTop: string;
  }): Promise<number> {
    const memberships = await this.prisma.membership.findMany({
      where: { orgId: args.tenantId, role: { in: ['owner', 'coo'] } },
      select: { userId: true },
    });
    if (memberships.length === 0) return 0;

    const rawBody = args.shortSummary ?? args.bodyMarkdown;
    const safeBody = rawBody.length > 2000 ? rawBody.slice(0, 1999) + '…' : rawBody;

    let sent = 0;
    for (const m of memberships) {
      try {
        await this.conversational.sendNotification({
          tenantId: args.tenantId,
          recipientUserId: m.userId,
          eventType: 'goals.pulse',
          payload: {
            digestId: args.digestId,
            isoWeek: args.isoWeek,
            title: 'Пульс целей за неделю',
            body: safeBody,
            actionUrl: '/goals',
          },
          dataClass: 'internal',
        });
        sent++;
        this.metrics.incGoalsPulseDelivered({
          tenantTop: args.tenantTop,
          channel: 'conversational',
        });
      } catch (err) {
        this.metrics.incGoalsPulseFailed({
          tenantTop: args.tenantTop,
          reason: 'notify_failed',
        });
        this.logger.warn(
          {
            tenantId: args.tenantId,
            userId: m.userId,
            err: err instanceof Error ? err.message : String(err),
          },
          'goals-pulse.cron: sendNotification упал',
        );
      }
    }
    return sent;
  }

  private async listOrgsWithActiveGoals(): Promise<string[]> {
    const rows = await this.prisma.goal.findMany({
      where: { promotionState: 'active', validUntil: null, archivedAt: null },
      distinct: ['tenantId'],
      select: { tenantId: true },
      take: 5_000,
    });
    return rows.map((r) => r.tenantId);
  }
}
