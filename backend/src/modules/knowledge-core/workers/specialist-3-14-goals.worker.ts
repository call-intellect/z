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
import { Specialist314GoalsService } from '../services/specialist-3-14-goals.service';

/**
 * Goals OKR v2 (2026-06-02, Фаза 2) — Specialist 3-14 (Goals) — consumer
 * `core.specialist-routing` с jobName='3-14-goals'.
 *
 * Запускается, когда `RouterService.dispatch` диспатчит блок
 * (`signalType ∈ { 'commitment', 'plan_item' }`) этому специалисту. Воркер
 * фильтрует jobs других специалистов по `job.name`.
 *
 * Логика делегируется в `Specialist314GoalsService.processBlock`
 * (extract → KNN → hierarchy-арбитр → create Goal + опц. KR).
 *
 * Метрики:
 *   - `core_specialist_pipeline_duration_seconds{type='goal'}`.
 *
 * Concurrency=2 — баланс параллелизма и LLM rate-limit'ов (как 3.1/3.3).
 */
@Injectable()
export class Specialist314GoalsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(Specialist314GoalsWorker.name);
  private worker: Worker<SpecialistRoutingJobData> | null = null;

  /** Имя специалиста (jobName-фильтр). Совпадает с RouterService.SPECIALIST.GOALS. */
  static readonly SPECIALIST_NAME = RouterService.SPECIALIST.GOALS;

  /** signalType'ы, которые обрабатывает этот специалист. */
  static readonly ALLOWED_SIGNAL_TYPES: ReadonlySet<string> = new Set([
    'commitment',
    'plan_item',
  ]);

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Specialist314GoalsService)
    private readonly svc: Specialist314GoalsService,
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
        'specialist-3-14: job failed (повтор по политике BullMQ)',
      );
    });
    this.logger.log(
      `Specialist314GoalsWorker запущен (${CORE_QUEUE_NAMES.SPECIALIST_ROUTING}, jobName=${Specialist314GoalsWorker.SPECIALIST_NAME})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  private async process(job: Job<SpecialistRoutingJobData>): Promise<void> {
    // jobName-фильтр: пропускаем jobs других специалистов.
    if (job.name !== Specialist314GoalsWorker.SPECIALIST_NAME) {
      return;
    }

    const start = Date.now();
    const { blockId, tenantId } = job.data;

    try {
      const block = await this.prisma.ideaBlock.findUnique({
        where: { id: blockId },
        select: { id: true, tenantId: true, status: true, signalType: true },
      });
      if (!block) {
        this.logger.debug({ blockId }, 'specialist-3-14: блок не найден — skip');
        return;
      }
      if (block.tenantId !== tenantId) {
        this.logger.warn(
          { blockId, expected: tenantId, actual: block.tenantId },
          'specialist-3-14: tenant mismatch — skip',
        );
        return;
      }
      if (block.status !== 'canonical') {
        this.logger.debug(
          { blockId, status: block.status },
          'specialist-3-14: блок ещё не canonical — skip',
        );
        return;
      }
      if (!Specialist314GoalsWorker.ALLOWED_SIGNAL_TYPES.has(block.signalType)) {
        this.logger.debug(
          { blockId, signalType: block.signalType },
          'specialist-3-14: signalType вне области специалиста — skip',
        );
        return;
      }

      await this.svc.processBlock({ tenantId, blockId });

      this.logger.log(
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
