import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ProcessTemplateCompletenessService } from '../../processes/services/process-template-completeness.service';
import { resolveProcessTenantTop } from '../../processes/services/tenant-top';

/**
 * SBA α-7 wave 2 — ProcessTemplateCompletenessCron.
 *
 * Раз в сутки (по умолчанию 03:00 UTC, см. ENV PROCESS_TEMPLATE_COMPLETENESS_CRON)
 * пересчитывает completeness для всех `ProcessTemplate` с `status != 'archived'`
 * и обновляет gauge'и Prometheus:
 *   - `process_templates_total{tenant_top, status}`
 *   - `process_template_completeness_avg{tenant_top}`
 *
 * Не бросает наружу. Один упавший template не валит проход. Cron-выражение
 * литералом в декораторе (`'0 3 * * *'`), фактический ENV хранится для логов
 * и будущей перерегистрации через SchedulerRegistry.
 */
@Injectable()
export class ProcessTemplateCompletenessCron {
  private readonly logger = new Logger(ProcessTemplateCompletenessCron.name);
  private static readonly BATCH_SIZE = 200;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProcessTemplateCompletenessService)
    private readonly completeness: ProcessTemplateCompletenessService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 3 * * *')
  async sweep(): Promise<void> {
    try {
      const stats = await this.runOnce();
      this.logger.debug(
        stats,
        'process-template-completeness: проход завершён',
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'process-template-completeness: проход упал',
      );
    }
  }

  async runOnce(): Promise<{
    tenantsProcessed: number;
    templatesRecalculated: number;
  }> {
    const tenants = await this.prisma.processTemplate.findMany({
      where: { deletedAt: null, status: { not: 'archived' } },
      distinct: ['tenantId'],
      select: { tenantId: true },
    });

    let templatesRecalculated = 0;
    for (const { tenantId } of tenants) {
      const templates = await this.prisma.processTemplate.findMany({
        where: {
          tenantId,
          deletedAt: null,
          status: { not: 'archived' },
        },
        select: { id: true, status: true },
        take: ProcessTemplateCompletenessCron.BATCH_SIZE,
      });
      const completenessByStatus: Record<string, number[]> = {
        draft: [],
        active: [],
        archived: [],
      };
      for (const tpl of templates) {
        try {
          const { completeness } = await this.completeness.recalculateAndPersist({
            tenantId,
            templateId: tpl.id,
          });
          const key = (completenessByStatus[tpl.status as string] ??= []);
          key.push(completeness);
          templatesRecalculated += 1;
        } catch (err) {
          this.logger.debug(
            {
              tenantId,
              templateId: tpl.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'completeness recalc: skip (best-effort)',
          );
        }
      }

      // Также подтянем archived count (без recalc — completeness для archived
      // не имеет смысла) для полноты gauge'а.
      const archivedCount = await this.prisma.processTemplate.count({
        where: { tenantId, status: 'archived', deletedAt: null },
      });
      completenessByStatus.archived = new Array(archivedCount).fill(0);

      const tenantTop = resolveProcessTenantTop(tenantId);
      for (const status of Object.keys(completenessByStatus)) {
        const count = completenessByStatus[status]?.length ?? 0;
        this.metrics.setProcessTemplatesTotal({
          tenantTop,
          status,
          value: count,
        });
      }

      const activeValues = completenessByStatus.active ?? [];
      const avg =
        activeValues.length === 0
          ? 0
          : activeValues.reduce((a, b) => a + b, 0) / activeValues.length;
      this.metrics.setProcessTemplateCompletenessAvg({
        tenantTop,
        value: avg,
      });
    }

    return {
      tenantsProcessed: tenants.length,
      templatesRecalculated,
    };
  }
}
