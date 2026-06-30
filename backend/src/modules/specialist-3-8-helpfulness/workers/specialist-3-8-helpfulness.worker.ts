import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Job } from 'bullmq';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { type SpecialistRoutingJobData } from '../../core-queue/queues';
import { Specialist38HelpfulnessService } from '../services/specialist-3-8-helpfulness.service';

@Injectable()
export class Specialist38HelpfulnessWorker {
  private readonly logger = new Logger(Specialist38HelpfulnessWorker.name);

  static readonly SPECIALIST_NAME = '3-8-helpfulness';

  static readonly ALLOWED_SIGNAL_TYPES: ReadonlySet<string> = new Set([
    'help_provided',
    'proactive_hint',
    'mentoring',
    'emotional_support',
    'constructive_feedback',
    'question_unanswered',
    'question_acknowledged_no_action',
    'helped_by',
    'helped_to',
    'thanks_explicit',
    'task_comment',
    'task_mention',
  ]);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Specialist38HelpfulnessService)
    private readonly svc: Specialist38HelpfulnessService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async handle(job: Job<SpecialistRoutingJobData>): Promise<void> {
    const start = Date.now();
    const { blockId, tenantId, signalType } = job.data;

    if (signalType && !Specialist38HelpfulnessWorker.ALLOWED_SIGNAL_TYPES.has(signalType)) {
      this.logger.debug(
        { blockId, signalType },
        'specialist-3-8: signalType вне области специалиста — skip',
      );
      this.metrics.incCoreSpecialistSkipped({
        specialist: Specialist38HelpfulnessWorker.SPECIALIST_NAME,
        reason: 'signal_out_of_scope',
      });
      return;
    }

    try {
      const block = await this.prisma.ideaBlock.findUnique({
        where: { id_tenantId: { id: blockId, tenantId } },
        select: {
          id: true,
          tenantId: true,
          status: true,
          signalType: true,
        },
      });
      if (!block) {
        this.logger.debug({ blockId }, 'specialist-3-8: блок не найден — skip');
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist38HelpfulnessWorker.SPECIALIST_NAME,
          reason: 'block_not_found',
        });
        return;
      }
      if (block.tenantId !== tenantId) {
        this.logger.warn(
          { blockId, expected: tenantId, actual: block.tenantId },
          'specialist-3-8: tenant mismatch — skip',
        );
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist38HelpfulnessWorker.SPECIALIST_NAME,
          reason: 'tenant_mismatch',
        });
        return;
      }
      if (block.status !== 'canonical') {
        this.logger.debug(
          { blockId, status: block.status },
          'specialist-3-8: блок не canonical — skip',
        );
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist38HelpfulnessWorker.SPECIALIST_NAME,
          reason: 'not_canonical',
        });
        return;
      }
      if (!Specialist38HelpfulnessWorker.ALLOWED_SIGNAL_TYPES.has(block.signalType)) {
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist38HelpfulnessWorker.SPECIALIST_NAME,
          reason: 'signal_out_of_scope',
        });
        return;
      }

      const result = await this.svc.processBlock({ tenantId, blockId });
      if (result) {
        this.logger.debug(
          {
            blockId,
            signalType: block.signalType,
            traitsCreated: result.traitsCreated,
            traitsMerged: result.traitsMerged,
          },
          'specialist-3-8: блок обработан',
        );
      }
    } finally {
      this.metrics.observeCoreSpecialistPipelineDuration({
        type: Specialist38HelpfulnessService.METRIC_TYPE,
        seconds: (Date.now() - start) / 1000,
      });
    }
  }
}
