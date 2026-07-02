import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type {
  EntityType,
  IdeaBlockLinkType,
  IdeaBlockStatus,
  RawEventProcessingStatus,
  SignalType,
} from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class CoreMetricsSnapshotCron {
  private readonly logger = new Logger(CoreMetricsSnapshotCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @Cron('*/5 * * * *')
  async snapshot(): Promise<void> {
    try {
      await Promise.all([
        this.snapshotBlocks(),
        this.snapshotEntities(),
        this.snapshotLinks(),
        this.snapshotRawEvents(),
        this.snapshotRawEventStuck(),
        this.snapshotKcFactsOpen(),
      ]);
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'core-metrics-snapshot: непойманная ошибка',
      );
    }
  }

  private async snapshotBlocks(): Promise<void> {
    const rows = await this.prisma.ideaBlock.groupBy({
      by: ['tenantId', 'status'],
      _count: { _all: true },
    });
    for (const row of rows) {
      this.metrics.setCoreBlocks({
        tenant: row.tenantId,
        status: row.status as IdeaBlockStatus,
        count: row._count._all,
      });
    }
  }

  private async snapshotEntities(): Promise<void> {
    const rows = await this.prisma.entity.groupBy({
      by: ['tenantId', 'type'],
      _count: { _all: true },
    });
    for (const row of rows) {
      this.metrics.setCoreEntities({
        tenant: row.tenantId,
        type: row.type as EntityType,
        count: row._count._all,
      });
    }
  }

  private async snapshotLinks(): Promise<void> {
    const rows = await this.prisma.ideaBlockLink.groupBy({
      by: ['tenantId', 'relationType'],
      where: { status: 'active' },
      _count: { _all: true },
    });
    for (const row of rows) {
      this.metrics.setCoreLinks({
        tenant: row.tenantId,
        relationType: row.relationType as IdeaBlockLinkType,
        count: row._count._all,
      });
    }
  }

  private async snapshotRawEvents(): Promise<void> {
    const rows = await this.prisma.rawEvent.groupBy({
      by: ['tenantId', 'processingStatus'],
      _count: { _all: true },
    });
    for (const row of rows) {
      this.metrics.setCoreRawEvents({
        tenant: row.tenantId,
        processingStatus: row.processingStatus as RawEventProcessingStatus,
        count: row._count._all,
      });
    }
  }

  private async snapshotRawEventStuck(): Promise<void> {
    const staleMinutes = await this.cfg.getDynamic<number>(
      'knowledge.rawEventRecoveryStaleMinutes',
      undefined,
      30,
    );
    const staleBefore = new Date(Date.now() - staleMinutes * 60_000);
    const rows = await this.prisma.rawEvent.groupBy({
      by: ['tenantId', 'sourceType'],
      where: {
        processingStatus: 'received',
        receivedAt: { lt: staleBefore },
      },
      _count: { _all: true },
    });
    this.metrics.resetRawEventStuck();
    for (const row of rows) {
      this.metrics.setRawEventStuck({
        tenant: row.tenantId,
        sourceType: row.sourceType,
        count: row._count._all,
      });
    }
  }

  private async snapshotKcFactsOpen(): Promise<void> {
    const factTypes = this.cfg.bitemporal.factSignalTypes;
    if (!factTypes || factTypes.length === 0) return;

    const rows = await this.prisma.ideaBlock.groupBy({
      by: ['tenantId', 'signalType'],
      where: {
        status: 'canonical',
        validUntil: null,
        signalType: { in: factTypes as SignalType[] },
      },
      _count: { _all: true },
    });
    for (const row of rows) {
      this.metrics.setKcFactsOpen({
        tenant: row.tenantId,
        signalType: row.signalType as SignalType,
        count: row._count._all,
      });
    }
  }
}
