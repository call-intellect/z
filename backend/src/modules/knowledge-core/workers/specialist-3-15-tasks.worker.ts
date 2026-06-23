import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type Job } from 'bullmq';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { type SpecialistRoutingJobData } from '../../core-queue/queues';
import { RouterService } from '../services/router.service';
import { Specialist315TasksService } from '../services/specialist-3-15-tasks.service';

@Injectable()
export class Specialist315TasksWorker {
  private readonly logger = new Logger(Specialist315TasksWorker.name);

  static readonly SPECIALIST_NAME = RouterService.SPECIALIST.TASKS;

  static readonly ALLOWED_SIGNAL_TYPES: ReadonlySet<string> = new Set([
    'action_item',
  ]);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Specialist315TasksService)
    private readonly svc: Specialist315TasksService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
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
        this.logger.debug({ blockId }, 'specialist-3-15: блок не найден — skip');
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist315TasksWorker.SPECIALIST_NAME,
          reason: 'block_not_found',
        });
        return;
      }
      if (block.tenantId !== tenantId) {
        this.logger.warn(
          { blockId, expected: tenantId, actual: block.tenantId },
          'specialist-3-15: tenant mismatch — skip',
        );
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist315TasksWorker.SPECIALIST_NAME,
          reason: 'tenant_mismatch',
        });
        return;
      }
      if (block.status !== 'canonical') {
        this.logger.debug(
          { blockId, status: block.status },
          'specialist-3-15: блок ещё не canonical — skip',
        );
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist315TasksWorker.SPECIALIST_NAME,
          reason: 'not_canonical',
        });
        return;
      }
      if (!Specialist315TasksWorker.ALLOWED_SIGNAL_TYPES.has(block.signalType)) {
        this.logger.debug(
          { blockId, signalType: block.signalType },
          'specialist-3-15: signalType вне области специалиста — skip',
        );
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist315TasksWorker.SPECIALIST_NAME,
          reason: 'signal_out_of_scope',
        });
        return;
      }

      const mode =
        (await this.cfg?.getDynamic<'spine' | 'legacy'>(
          'tracker.taskExtractionMode',
          undefined,
          'spine',
        )) ?? 'spine';
      if (mode === 'legacy') {
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist315TasksWorker.SPECIALIST_NAME,
          reason: 'mode_legacy',
        });
        this.logger.debug(
          { blockId },
          'specialist-3-15: режим legacy — спайн-специалист bypass',
        );
        return;
      }

      await this.svc.processBlock({ tenantId, blockId });

      this.logger.debug(
        { blockId, signalType: block.signalType },
        'specialist-3-15: блок обработан',
      );
    } finally {
      this.metrics.observeCoreSpecialistPipelineDuration({
        type: 'task',
        seconds: (Date.now() - start) / 1000,
      });
    }
  }
}
