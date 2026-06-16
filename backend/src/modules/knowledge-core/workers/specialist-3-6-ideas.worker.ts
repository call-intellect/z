import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Job } from 'bullmq';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { type SpecialistRoutingJobData } from '../../core-queue/queues';
import { RouterService } from '../services/router.service';
import { Specialist36Service } from '../services/specialist-3-6-ideas.service';

@Injectable()
export class Specialist36IdeasWorker {
  private readonly logger = new Logger(Specialist36IdeasWorker.name);

  static readonly SPECIALIST_NAME = RouterService.SPECIALIST.IDEAS;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Specialist36Service) private readonly svc: Specialist36Service,
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
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist36IdeasWorker.SPECIALIST_NAME,
          reason: 'block_not_found',
        });
        return;
      }
      if (block.tenantId !== tenantId) {
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist36IdeasWorker.SPECIALIST_NAME,
          reason: 'tenant_mismatch',
        });
        return;
      }
      if (block.status !== 'canonical') {
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist36IdeasWorker.SPECIALIST_NAME,
          reason: 'not_canonical',
        });
        return;
      }
      const allowed = new Set(['idea', 'feature_request']);
      if (!allowed.has(block.signalType)) {
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist36IdeasWorker.SPECIALIST_NAME,
          reason: 'signal_out_of_scope',
        });
        return;
      }
      await this.svc.processBlock({ tenantId, blockId });
      this.logger.debug(
        { blockId, signalType: block.signalType },
        'specialist-3-6: блок обработан',
      );
    } finally {
      this.metrics.observeCoreSpecialistPipelineDuration({
        type: 'idea',
        seconds: (Date.now() - start) / 1000,
      });
    }
  }
}
