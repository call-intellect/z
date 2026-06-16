import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { CustomerRiskRadarService } from '../services/customer-risk-radar.service';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

import { yesterdayInMoscow } from './operations-daily-digest.cron';

@Injectable()
export class CustomerRiskRadarCron {
  private readonly logger = new Logger(CustomerRiskRadarCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(CustomerRiskRadarService)
    private readonly radar: CustomerRiskRadarService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 21 * * *')
  async run(): Promise<void> {
    const enabled = await this.cfg.getDynamic<boolean>(
      'operations.customer_risk_radar.enabled',
      'OPERATIONS_CUSTOMER_RISK_RADAR_ENABLED',
      true,
    );
    if (!enabled) {
      this.logger.debug(
        'customer-risk-radar.cron: operations.customer_risk_radar.enabled=false, skip',
      );
      return;
    }
    const now = new Date();
    try {
      const stats = await this.runOnce(now);
      this.logger.debug(stats, 'customer-risk-radar.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'customer-risk-radar.cron: непойманная ошибка',
      );
    }
  }

  async runOnce(now: Date): Promise<{
    orgsProcessed: number;
    snapshotsBuilt: number;
    managersNotified: number;
    errors: number;
  }> {
    const dateLocal = yesterdayInMoscow(now);

    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
      take: 5_000,
    });

    let snapshotsBuilt = 0;
    let managersNotified = 0;
    let errors = 0;

    for (const org of orgs) {
      const tenantTop = resolveOperationsTenantTop(org.id);
      let computed: Awaited<ReturnType<CustomerRiskRadarService['computeForTenant']>>;
      try {
        computed = await this.radar.computeForTenant({
          tenantId: org.id,
          dateLocal,
        });
        snapshotsBuilt += computed.snapshots.length;
      } catch (err) {
        errors++;
        this.metrics.incCustomerRiskRadarFailed({ reason: 'compute_failed' });
        this.logger.warn(
          {
            tenantId: org.id,
            tenantTop,
            err: err instanceof Error ? err.message : String(err),
          },
          'customer-risk-radar.cron: computeForTenant упал для Org',
        );
        continue;
      }

      for (const snap of computed.snapshots) {
        if (snap.riskLevel === 'ok') continue;
        if (!snap.responsiblePersonId) continue;
        try {
          const notified = await this.notifyManager({
            tenantId: org.id,
            snapshotId: snap.id,
            customerEntityId: snap.customerEntityId,
            responsiblePersonId: snap.responsiblePersonId,
            riskLevel: snap.riskLevel,
            dateLocal,
          });
          if (notified) managersNotified++;
        } catch (err) {
          errors++;
          this.metrics.incCustomerRiskRadarFailed({ reason: 'notify_failed' });
          this.logger.warn(
            {
              tenantId: org.id,
              snapshotId: snap.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'customer-risk-radar.cron: push менеджеру упал',
          );
        }
      }
    }

    return {
      orgsProcessed: orgs.length,
      snapshotsBuilt,
      managersNotified,
      errors,
    };
  }

  private async notifyManager(args: {
    tenantId: string;
    snapshotId: string;
    customerEntityId: string;
    responsiblePersonId: string;
    riskLevel: 'critical' | 'warning';
    dateLocal: string;
  }): Promise<boolean> {
    const snapshot = await this.prisma.customerRiskSnapshot.findUnique({
      where: { id: args.snapshotId },
      select: {
        deliveredManagerAt: true,
        signalCounts: true,
        topBlockIdsJson: true,
        customerEntity: { select: { canonicalName: true } },
        responsible: { select: { userId: true } },
      },
    });
    if (!snapshot) return false;
    if (snapshot.deliveredManagerAt) return false;
    const recipientUserId = snapshot.responsible?.userId;
    if (!recipientUserId) return false;

    const customerName = snapshot.customerEntity?.canonicalName ?? 'Клиент';
    const counts = parseCounts(snapshot.signalCounts);
    const signalDelta = await this.computeSignalDelta({
      tenantId: args.tenantId,
      customerEntityId: args.customerEntityId,
      dateLocal: args.dateLocal,
      todayCounts: counts,
    });
    const excerpts = await this.resolveExcerpts(args.tenantId, snapshot.topBlockIdsJson);

    const hint = await this.radar.buildHint({
      tenantId: args.tenantId,
      customerName,
      riskLevel: args.riskLevel,
      counts,
      signalDelta,
      topBlockExcerpts: excerpts,
    });

    await this.conversational.sendNotification({
      tenantId: args.tenantId,
      recipientUserId,
      eventType: 'proactive.notification',
      priorityTier: 1,
      payload: {
        proactiveNotificationId: args.snapshotId,
        ruleType: 'customer_risk',
        severity: args.riskLevel === 'critical' ? 'high' : 'medium',
        title: `Клиент под риском: ${customerName.slice(0, 80)}`,
        body: hint,
        actionUrl: '/me/customer-risk',
      },
      dataClass: 'internal',
    });
    this.metrics.incCustomerRiskManagerNotified();
    await this.radar.markManagerDelivered(args.snapshotId);
    return true;
  }

  private async computeSignalDelta(args: {
    tenantId: string;
    customerEntityId: string;
    dateLocal: string;
    todayCounts: ReturnType<typeof parseCounts>;
  }): Promise<number> {
    const todayScore = 0;
    const delta = await this.radar.computeDelta({
      tenantId: args.tenantId,
      customerEntityId: args.customerEntityId,
      dateLocal: args.dateLocal,
      todayScore,
      todayCounts: args.todayCounts,
    });
    return delta.signalDelta;
  }

  private async resolveExcerpts(tenantId: string, topBlockIdsJson: unknown): Promise<string[]> {
    const ids = Array.isArray(topBlockIdsJson)
      ? (topBlockIdsJson as unknown[]).filter((v): v is string => typeof v === 'string').slice(0, 3)
      : [];
    if (ids.length === 0) return [];
    const blocks = await this.prisma.ideaBlock.findMany({
      where: { tenantId, id: { in: ids } },
      select: { name: true, criticalQuestion: true },
      take: 3,
    });
    return blocks.map((b) => (b.name || b.criticalQuestion || '').slice(0, 160));
  }
}

function parseCounts(raw: unknown): {
  churn_risk: number;
  objection: number;
  pain: number;
  feature_request: number;
} {
  const out = { churn_risk: 0, objection: 0, pain: 0, feature_request: 0 };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const map = raw as Record<string, unknown>;
    for (const k of Object.keys(out) as Array<keyof typeof out>) {
      const v = map[k];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = v;
    }
  }
  return out;
}
