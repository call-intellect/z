import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { resourceTypeRu } from '../../pending-actions/resource-type-ru';

@Injectable()
export class CardStaleDetectorCron {
  private readonly logger = new Logger(CardStaleDetectorCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
  ) {}

  @Cron('0 4 * * *')
  async runStaleDetection(): Promise<void> {
    try {
      const summary = await this.runForAllOrgs();
      this.logger.debug(summary, 'card-stale-detector: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'card-stale-detector: непойманная ошибка',
      );
    }
  }

  async runForAllOrgs(): Promise<{
    scannedOrgs: number;
    candidatesDetected: number;
    itemsCreated: number;
    probesSent: number;
  }> {
    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    const months = this.cfg.curation.staleMonthsThreshold;
    const expiryDays = this.cfg.curation.itemExpiryDays;
    const cutoff = new Date();
    cutoff.setUTCMonth(cutoff.getUTCMonth() - months);

    let candidatesDetected = 0;
    let itemsCreated = 0;
    let probesSent = 0;

    for (const org of orgs) {
      const candidates = await this.findStaleCandidates(org.id, cutoff);
      candidatesDetected += candidates.length;

      for (const c of candidates) {
        try {
          const existing = await this.prisma.curationItem.findFirst({
            where: {
              tenantId: org.id,
              resourceType: c.resourceType,
              resourceId: c.resourceId,
              status: 'pending',
            },
            select: { id: true },
          });
          if (existing) continue;

          const expiresAt = new Date();
          expiresAt.setUTCDate(expiresAt.getUTCDate() + expiryDays);

          const item = await this.prisma.curationItem.create({
            data: {
              tenantId: org.id,
              resourceType: c.resourceType,
              resourceId: c.resourceId,
              level: 'light',
              triageReason: {
                reason: 'stale',
                lastVersionAt: c.lastVersionAt.toISOString(),
                monthsThreshold: months,
              } as Prisma.InputJsonValue,
              proposedPayload: (c.payload ?? {}) as Prisma.InputJsonValue,
              candidateCuratorIds: c.createdByUserId ? [c.createdByUserId] : [],
              expiresAt,
            },
          });
          itemsCreated += 1;

          this.metrics.incCurationStale({ resourceType: c.resourceType });
          this.metrics.incCurationItem({
            resourceType: c.resourceType,
            level: 'light',
            status: 'pending',
          });

          if (c.createdByUserId) {
            try {
              await this.conversational.sendNotification({
                tenantId: org.id,
                recipientUserId: c.createdByUserId,
                eventType: 'system.message',
                payload: {
                  title: 'Карточка давно не подтверждалась',
                  body: `Карточка «${resourceTypeRu(c.resourceType)}» не подтверждалась более ${months} мес. Подтвердите актуальность или внесите правки.`,
                  severity: 'info',
                  actionUrl: `/curation/${item.id}`,
                },
                dataClass: 'internal',
                contextCardId: c.resourceId,
                expiresAt: expiresAt.toISOString(),
              });
              probesSent += 1;
            } catch (err) {
              this.logger.warn(
                {
                  tenantId: org.id,
                  resourceId: c.resourceId,
                  err: err instanceof Error ? err.message : String(err),
                },
                'card-stale-detector: ошибка отправки probe — пропускаю',
              );
            }
          }
        } catch (err) {
          this.logger.warn(
            {
              tenantId: org.id,
              resourceId: c.resourceId,
              err: err instanceof Error ? err.message : String(err),
            },
            'card-stale-detector: ошибка обработки кандидата — пропускаю',
          );
        }
      }
    }

    return {
      scannedOrgs: orgs.length,
      candidatesDetected,
      itemsCreated,
      probesSent,
    };
  }

  private async findStaleCandidates(
    tenantId: string,
    cutoff: Date,
  ): Promise<
    Array<{
      resourceType: string;
      resourceId: string;
      payload: Prisma.JsonValue;
      createdByUserId: string | null;
      lastVersionAt: Date;
    }>
  > {
    const rows = await this.prisma.$queryRaw<
      Array<{
        resourceType: string;
        resourceId: string;
        payload: Prisma.JsonValue;
        createdByUserId: string | null;
        createdAt: Date;
      }>
    >`
      SELECT DISTINCT ON ("resourceType", "resourceId")
        "resourceType",
        "resourceId",
        payload,
        "createdByUserId",
        "createdAt"
      FROM "CardVersion"
      WHERE "tenantId" = ${tenantId}
        AND "createdAt" < ${cutoff}
      ORDER BY "resourceType", "resourceId", "createdAt" DESC
      LIMIT 100
    `;
    return rows.map((r) => ({
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      payload: r.payload,
      createdByUserId: r.createdByUserId,
      lastVersionAt: r.createdAt,
    }));
  }
}
