import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import {
  CORE_QUEUE_NAMES,
  type SpecialistRoutingJobData,
} from '../../core-queue/queues';
import { RouterService } from '../services/router.service';
import { Specialist36Service } from '../services/specialist-3-6-ideas.service';

/**
 * SBA β-5 — Specialist 3.6 (Ideas Collector) worker.
 *
 * Consumer `core.specialist-routing` jobName='3-6-ideas'. Делегирует в
 * `Specialist36Service.processBlock`.
 *
 * Идемпотентность через jobId `3-6-ideas_<blockId>` + KNN-кластеризацию
 * existing Idea в сервисе.
 */
@Injectable()
export class Specialist36IdeasWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(Specialist36IdeasWorker.name);
  private worker: Worker<SpecialistRoutingJobData> | null = null;

  static readonly SPECIALIST_NAME = RouterService.SPECIALIST.IDEAS;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Specialist36Service) private readonly svc: Specialist36Service,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<SpecialistRoutingJobData>(
      CORE_QUEUE_NAMES.SPECIALIST_ROUTING,
      async (job) => this.process(job),
      {
        connection: this.redis.client,
        concurrency: 2,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        {
          blockId: job?.data?.blockId,
          jobName: job?.name,
          attempt: job?.attemptsMade,
          err: err?.message,
        },
        'specialist-3-6: job failed (повтор по политике BullMQ)',
      );
    });
    this.logger.log(
      `Specialist36IdeasWorker запущен (${CORE_QUEUE_NAMES.SPECIALIST_ROUTING}, jobName=${Specialist36IdeasWorker.SPECIALIST_NAME})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  private async process(job: Job<SpecialistRoutingJobData>): Promise<void> {
    if (job.name !== Specialist36IdeasWorker.SPECIALIST_NAME) return;
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
