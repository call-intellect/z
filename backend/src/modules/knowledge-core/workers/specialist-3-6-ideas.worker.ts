import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Job } from 'bullmq';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { type SpecialistRoutingJobData } from '../../core-queue/queues';
import { RouterService } from '../services/router.service';
import { Specialist36Service } from '../services/specialist-3-6-ideas.service';

/**
 * SBA β-5 — Specialist 3.6 (Ideas Collector) handler.
 *
 * Handler `core.specialist-routing` jobName='3-6-ideas'. Вызывается из
 * `SpecialistRoutingDispatcherWorker.dispatch`; делегирует в
 * `Specialist36Service.processBlock`.
 *
 * Идемпотентность через jobId `3-6-ideas_<blockId>` + KNN-кластеризацию
 * existing Idea в сервисе.
 */
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
      if (!block) return;
      if (block.tenantId !== tenantId) return;
      if (block.status !== 'canonical') return;
      const allowed = new Set(['idea', 'feature_request']);
      if (!allowed.has(block.signalType)) return;
      await this.svc.processBlock({ tenantId, blockId });
      this.logger.log(
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
