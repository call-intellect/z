import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type {
  EntityType,
  IdeaBlockLinkType,
  IdeaBlockStatus,
  RawEventProcessingStatus,
} from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * CoreMetricsSnapshotCron (Фаза 11 knowledge-core).
 *
 * Раз в 5 минут snapshot'ит per-tenant счётчики knowledge-core в gauge'и
 * `core_blocks_total` / `core_entities_total` / `core_links_total` /
 * `core_raw_events_total`. Реализован через Prisma `groupBy`, без сырого
 * SQL — на масштабе 100k блоков по сотне Org это дёшево.
 *
 * NB: gauge.set перезаписывает значение (а не накапливает) — комбинация
 * (tenant, status), которая больше не встречается в выборке, остаётся
 * с устаревшим значением до следующего рестарта процесса. Чтобы избежать
 * этого, на каждом проходе мы предварительно собираем все актуальные
 * (tenant, status) из БД и не пытаемся «обнулять» отсутствующие — это
 * допустимый компромисс для MVP (графики Grafana покажут «срез последний раз»;
 * при появлении новых статусов gauge будет обновлён).
 */
@Injectable()
export class CoreMetricsSnapshotCron {
  private readonly logger = new Logger(CoreMetricsSnapshotCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('*/5 * * * *')
  async snapshot(): Promise<void> {
    try {
      await Promise.all([
        this.snapshotBlocks(),
        this.snapshotEntities(),
        this.snapshotLinks(),
        this.snapshotRawEvents(),
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
}
