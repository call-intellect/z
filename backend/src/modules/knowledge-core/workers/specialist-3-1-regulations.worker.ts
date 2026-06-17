import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Job } from 'bullmq';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { type SpecialistRoutingJobData } from '../../core-queue/queues';
import { RouterService } from '../services/router.service';
import { Specialist31Service } from '../services/specialist-3-1-regulations.service';

@Injectable()
export class Specialist31RegulationsWorker {
  private readonly logger = new Logger(Specialist31RegulationsWorker.name);

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
        this.logger.debug({ blockId }, 'specialist-3-1: блок не найден — skip');
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist31RegulationsWorker.SPECIALIST_NAME,
          reason: 'block_not_found',
        });
        return;
      }
      if (block.tenantId !== tenantId) {
        this.logger.warn(
          { blockId, expected: tenantId, actual: block.tenantId },
          'specialist-3-1: tenant mismatch — skip',
        );
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist31RegulationsWorker.SPECIALIST_NAME,
          reason: 'tenant_mismatch',
        });
        return;
      }
      if (block.status !== 'canonical') {
        this.logger.debug(
          { blockId, status: block.status },
          'specialist-3-1: блок ещё не canonical — skip',
        );
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist31RegulationsWorker.SPECIALIST_NAME,
          reason: 'not_canonical',
        });
        return;
      }

      if (block.signalType === 'regulation') {
        await this.svc.processRegulationBlock(block);
      } else if (block.signalType === 'process_step') {
        await this.svc.processProcessStepBlock(block);
      } else {
        this.logger.debug(
          { blockId, signalType: block.signalType },
          'specialist-3-1: signalType вне области специалиста — skip',
        );
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist31RegulationsWorker.SPECIALIST_NAME,
          reason: 'signal_out_of_scope',
        });
        return;
      }

      this.logger.debug(
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
