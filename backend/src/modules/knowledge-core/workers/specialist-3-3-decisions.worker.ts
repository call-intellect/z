import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type Job } from 'bullmq';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { type SpecialistRoutingJobData } from '../../core-queue/queues';
import { DashboardQueueService } from '../../dashboard/services/dashboard-queue.service';
import { RouterService } from '../services/router.service';
import { Specialist33Service } from '../services/specialist-3-3-decisions.service';

@Injectable()
export class Specialist33DecisionsWorker {
  private readonly logger = new Logger(Specialist33DecisionsWorker.name);

  static readonly SPECIALIST_NAME = RouterService.SPECIALIST.DECISIONS;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Specialist33Service) private readonly svc: Specialist33Service,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Optional()
    @Inject(DashboardQueueService)
    private readonly dashboardQueue?: DashboardQueueService,
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
        this.logger.debug({ blockId }, 'specialist-3-3: блок не найден — skip');
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist33DecisionsWorker.SPECIALIST_NAME,
          reason: 'block_not_found',
        });
        return;
      }
      if (block.tenantId !== tenantId) {
        this.logger.warn(
          { blockId, expected: tenantId, actual: block.tenantId },
          'specialist-3-3: tenant mismatch — skip',
        );
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist33DecisionsWorker.SPECIALIST_NAME,
          reason: 'tenant_mismatch',
        });
        return;
      }
      if (block.status !== 'canonical') {
        this.logger.debug(
          { blockId, status: block.status },
          'specialist-3-3: блок ещё не canonical — skip',
        );
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist33DecisionsWorker.SPECIALIST_NAME,
          reason: 'not_canonical',
        });
        return;
      }
      if (
        block.signalType !== 'decision' &&
        block.signalType !== 'rationale' &&
        block.signalType !== 'decision_basis'
      ) {
        this.logger.debug(
          { blockId, signalType: block.signalType },
          'specialist-3-3: signalType вне области специалиста — skip',
        );
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist33DecisionsWorker.SPECIALIST_NAME,
          reason: 'signal_out_of_scope',
        });
        return;
      }

      await this.svc.processBlock({ tenantId, blockId });

      this.logger.debug(
        { blockId, signalType: block.signalType },
        'specialist-3-3: блок обработан',
      );

      if (this.dashboardQueue) {
        await this.enqueueHygieneForBlock({ tenantId, blockId }).catch((err) => {
          this.logger.warn(
            {
              blockId,
              err: err instanceof Error ? err.message : String(err),
            },
            'specialist-3-3: enqueueHygiene упал — пропуск',
          );
        });
      }
    } finally {
      this.metrics.observeCoreSpecialistPipelineDuration({
        type: 'decision',
        seconds: (Date.now() - start) / 1000,
      });
    }
  }

  private async enqueueHygieneForBlock(args: { tenantId: string; blockId: string }): Promise<void> {
    const dq = this.dashboardQueue;
    if (!dq) return;
    const decisions = await this.prisma.decision.findMany({
      where: {
        tenantId: args.tenantId,
        reversibility: null,
        OR: [{ sourceIdeaBlockId: args.blockId }, { sourceBlockIds: { has: args.blockId } }],
      },
      select: { id: true },
    });
    for (const d of decisions) {
      await dq.enqueueDecisionHygiene({
        decisionId: d.id,
        tenantId: args.tenantId,
      });
    }
  }
}
