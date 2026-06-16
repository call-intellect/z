import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Job } from 'bullmq';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { type SpecialistRoutingJobData } from '../../core-queue/queues';
import { RouterService } from '../services/router.service';
import { Specialist35Service } from '../services/specialist-3-5-insights.service';

/**
 * SBA β-4 — Specialist 3.5 (Insights Radar) — handler
 * `core.specialist-routing` с jobName='3-5-insights'.
 *
 * Вызывается из `SpecialistRoutingDispatcherWorker.dispatch` для блоков с
 * signalType ∈ { pain, risk, churn_risk, objection }, которые
 * RouterService.dispatch диспатчит этому специалисту. Маршрутизацию по jobName
 * делает диспетчер.
 *
 * Логика делегируется в `Specialist35Service.processBlock`. См. sub-TZ
 * `plans/tz/2026-05-21-sba-beta-4-specialist-3-5-insights.md` §5.
 *
 * Идемпотентность:
 *   - jobId диспатча = `'3-5-insights_<blockId>'` (см. CoreQueueService).
 *   - Внутри Specialist35Service — KNN-кластеризация на existing Insight'ах
 *     гарантирует, что повторная обработка того же блока обновит уже
 *     существующий Insight, а не создаст дубликат.
 *
 * Метрики:
 *   - `core_specialist_pipeline_duration_seconds{type='insight'}`.
 */
@Injectable()
export class Specialist35InsightsWorker {
  private readonly logger = new Logger(Specialist35InsightsWorker.name);

  /** Имя специалиста (ключ маршрутизации диспетчера). Совпадает с RouterService.SPECIALIST.INSIGHTS. */
  static readonly SPECIALIST_NAME = RouterService.SPECIALIST.INSIGHTS;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Specialist35Service) private readonly svc: Specialist35Service,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async handle(job: Job<SpecialistRoutingJobData>): Promise<void> {
    const start = Date.now();
    const { blockId, tenantId } = job.data;

    try {
      const block = await this.prisma.ideaBlock.findUnique({
        where: { id: blockId },
        select: { id: true, tenantId: true, status: true, signalType: true },
      });
      if (!block) {
        this.logger.debug(
          { blockId },
          'specialist-3-5: блок не найден — skip',
        );
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist35InsightsWorker.SPECIALIST_NAME,
          reason: 'block_not_found',
        });
        return;
      }
      if (block.tenantId !== tenantId) {
        this.logger.warn(
          { blockId, expected: tenantId, actual: block.tenantId },
          'specialist-3-5: tenant mismatch — skip',
        );
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist35InsightsWorker.SPECIALIST_NAME,
          reason: 'tenant_mismatch',
        });
        return;
      }
      if (block.status !== 'canonical') {
        this.logger.debug(
          { blockId, status: block.status },
          'specialist-3-5: блок ещё не canonical — skip',
        );
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist35InsightsWorker.SPECIALIST_NAME,
          reason: 'not_canonical',
        });
        return;
      }
      // sub-TZ §5 — допустимые signalType.
      const allowed = new Set(['pain', 'risk', 'churn_risk', 'objection']);
      if (!allowed.has(block.signalType)) {
        this.logger.debug(
          { blockId, signalType: block.signalType },
          'specialist-3-5: signalType вне области специалиста — skip',
        );
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist35InsightsWorker.SPECIALIST_NAME,
          reason: 'signal_out_of_scope',
        });
        return;
      }

      await this.svc.processBlock({ tenantId, blockId });

      this.logger.debug(
        { blockId, signalType: block.signalType },
        'specialist-3-5: блок обработан',
      );
    } finally {
      this.metrics.observeCoreSpecialistPipelineDuration({
        type: 'insight',
        seconds: (Date.now() - start) / 1000,
      });
    }
  }
}
