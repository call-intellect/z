import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Job } from 'bullmq';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { type SpecialistRoutingJobData } from '../../core-queue/queues';
import { RouterService } from '../services/router.service';
import { Specialist31Service } from '../services/specialist-3-1-regulations.service';

/**
 * SBA α-7 — Specialist 3.1 (Regulations) — handler `core.specialist-routing`
 * с jobName='3-1-regulations'.
 *
 * Вызывается из `SpecialistRoutingDispatcherWorker.dispatch` для блоков
 * (`signalType='regulation'` или `'process_step'`), которые `RouterService.dispatch`
 * диспатчит этому специалисту. Маршрутизацию по jobName делает диспетчер.
 *
 * Логика:
 *   1. Загрузить block + evidence + entities.
 *   2. Проверить tenant + status ('canonical' — только из BlockDistillWorker'а
 *      опубликованные блоки участвуют в специалистах; draft пропускаем).
 *   3. По signalType вызвать соответствующий метод Specialist31Service.
 *
 * Идемпотентность:
 *   - jobId диспатча = `'3-1-regulations_<blockId>'` (см. RouterService).
 *   - Внутри Specialist31Service — upsert по (tenantId, name), так что
 *     повторный запуск с тем же блоком безопасен.
 *
 * Метрики:
 *   - `core_specialist_pipeline_duration_seconds{type='regulation'}` —
 *     длительность полного цикла специалиста.
 */
@Injectable()
export class Specialist31RegulationsWorker {
  private readonly logger = new Logger(Specialist31RegulationsWorker.name);

  /**
   * Имя специалиста (ключ маршрутизации диспетчера). Должно совпадать со
   * значением `RouterService.SPECIALIST.REGULATIONS`.
   */
  static readonly SPECIALIST_NAME = RouterService.SPECIALIST.REGULATIONS;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Specialist31Service) private readonly svc: Specialist31Service,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async handle(job: Job<SpecialistRoutingJobData>): Promise<void> {
    const start = Date.now();
    const { blockId, tenantId } = job.data;

    try {
      const block = await this.prisma.ideaBlock.findUnique({
        where: { id: blockId },
        include: {
          evidence: true,
          entities: true,
        },
      });
      if (!block) {
        this.logger.debug(
          { blockId },
          'specialist-3-1: блок не найден — skip',
        );
        return;
      }
      if (block.tenantId !== tenantId) {
        this.logger.warn(
          { blockId, expected: tenantId, actual: block.tenantId },
          'specialist-3-1: tenant mismatch — skip',
        );
        return;
      }
      if (block.status !== 'canonical') {
        this.logger.debug(
          { blockId, status: block.status },
          'specialist-3-1: блок ещё не canonical — skip',
        );
        return;
      }

      // Делегация по signalType. Specialist31Service сам fallback'ит по kind.
      if (block.signalType === 'regulation') {
        await this.svc.processRegulationBlock(block);
      } else if (block.signalType === 'process_step') {
        await this.svc.processProcessStepBlock(block);
      } else {
        this.logger.debug(
          { blockId, signalType: block.signalType },
          'specialist-3-1: signalType вне области специалиста — skip',
        );
        return;
      }

      this.logger.log(
        {
          blockId,
          signalType: block.signalType,
        },
        'specialist-3-1: блок обработан',
      );
    } finally {
      this.metrics.observeCoreSpecialistPipelineDuration({
        type: 'regulation',
        seconds: (Date.now() - start) / 1000,
      });
    }
  }
}
