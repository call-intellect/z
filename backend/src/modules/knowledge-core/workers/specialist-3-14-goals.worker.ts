import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Job } from 'bullmq';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { type SpecialistRoutingJobData } from '../../core-queue/queues';
import { RouterService } from '../services/router.service';
import { Specialist314GoalsService } from '../services/specialist-3-14-goals.service';

@Injectable()
export class Specialist314GoalsWorker {
  private readonly logger = new Logger(Specialist314GoalsWorker.name);

  static readonly SPECIALIST_NAME = RouterService.SPECIALIST.GOALS;

  static readonly ALLOWED_SIGNAL_TYPES: ReadonlySet<string> = new Set(['commitment', 'plan_item']);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Specialist314GoalsService)
    private readonly svc: Specialist314GoalsService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async handle(job: Job<SpecialistRoutingJobData>): Promise<void> {
    const start = Date.now();
    const { blockId, tenantId } = job.data;

    try {
      const block = await this.prisma.ideaBlock.findUnique({
        where: { id_tenantId: { id: blockId, tenantId } },
        select: { id: true, tenantId: true, status: true, signalType: true },
      });
      if (!block) {
        this.logger.debug({ blockId }, 'specialist-3-14: блок не найден — skip');
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist314GoalsWorker.SPECIALIST_NAME,
          reason: 'block_not_found',
        });
        return;
      }
      if (block.tenantId !== tenantId) {
        this.logger.warn(
          { blockId, expected: tenantId, actual: block.tenantId },
          'specialist-3-14: tenant mismatch — skip',
        );
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist314GoalsWorker.SPECIALIST_NAME,
          reason: 'tenant_mismatch',
        });
        return;
      }
      if (block.status !== 'canonical') {
        this.logger.debug(
          { blockId, status: block.status },
          'specialist-3-14: блок ещё не canonical — skip',
        );
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist314GoalsWorker.SPECIALIST_NAME,
          reason: 'not_canonical',
        });
        return;
      }
      if (!Specialist314GoalsWorker.ALLOWED_SIGNAL_TYPES.has(block.signalType)) {
        this.logger.debug(
          { blockId, signalType: block.signalType },
          'specialist-3-14: signalType вне области специалиста — skip',
        );
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist314GoalsWorker.SPECIALIST_NAME,
          reason: 'signal_out_of_scope',
        });
        return;
      }

      await this.svc.processBlock({ tenantId, blockId });

      this.logger.debug(
        { blockId, signalType: block.signalType },
        'specialist-3-14: блок обработан',
      );
    } finally {
      this.metrics.observeCoreSpecialistPipelineDuration({
        type: 'goal',
        seconds: (Date.now() - start) / 1000,
      });
    }
  }
}
