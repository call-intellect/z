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
import { Specialist35Service } from '../services/specialist-3-5-insights.service';

/**
 * SBA β-4 — Specialist 3.5 (Insights Radar) — consumer
 * `core.specialist-routing` с jobName='3-5-insights'.
 *
 * Запускается, когда RouterService.dispatch диспатчит блок с signalType ∈
 * { pain, risk, churn_risk, objection } этому специалисту. Воркер фильтрует
 * jobs других специалистов по `job.name`.
 *
 * Логика делегируется в `Specialist35Service.processBlock`. См. sub-TZ
 * `plans/tz/2026-05-21-sba-beta-4-specialist-3-5-insights.md` §5.
 *
 * Идемпотентность:
 *   - jobId диспатча = `'3-5-insights_<blockId>'` (см. CoreQueueService).
 *   - Внутри Specialist35Service — KNN-кластеризация на existing Insight'ах
 *     гарантирует, что повторная обработка того же блока обновит уже
 *     существующий Insight, а не создаст дубликат.
 *
 * Метрики:
 *   - `core_specialist_pipeline_duration_seconds{type='insight'}`.
 *
 * Concurrency=2 — баланс между параллелизмом и LLM rate-limit'ами, совпадает
 * с другими специалистами Слоя 3.
 */
@Injectable()
export class Specialist35InsightsWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(Specialist35InsightsWorker.name);
  private worker: Worker<SpecialistRoutingJobData> | null = null;

  /** Имя специалиста (jobName-фильтр). Совпадает с RouterService.SPECIALIST.INSIGHTS. */
  static readonly SPECIALIST_NAME = RouterService.SPECIALIST.INSIGHTS;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Specialist35Service) private readonly svc: Specialist35Service,
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
        'specialist-3-5: job failed (повтор по политике BullMQ)',
      );
    });
    this.logger.log(
      `Specialist35InsightsWorker запущен (${CORE_QUEUE_NAMES.SPECIALIST_ROUTING}, jobName=${Specialist35InsightsWorker.SPECIALIST_NAME})`,
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
    if (job.name !== Specialist35InsightsWorker.SPECIALIST_NAME) {
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
        this.logger.debug(
          { blockId },
          'specialist-3-5: блок не найден — skip',
        );
        return;
      }
      if (block.tenantId !== tenantId) {
        this.logger.warn(
          { blockId, expected: tenantId, actual: block.tenantId },
          'specialist-3-5: tenant mismatch — skip',
        );
        return;
      }
      if (block.status !== 'canonical') {
        this.logger.debug(
          { blockId, status: block.status },
          'specialist-3-5: блок ещё не canonical — skip',
        );
        return;
      }
      // sub-TZ §5 — допустимые signalType.
      const allowed = new Set(['pain', 'risk', 'churn_risk', 'objection']);
      if (!allowed.has(block.signalType)) {
        this.logger.debug(
          { blockId, signalType: block.signalType },
          'specialist-3-5: signalType вне области специалиста — skip',
        );
        return;
      }

      await this.svc.processBlock({ tenantId, blockId });

      this.logger.log(
        { blockId, signalType: block.signalType },
        'specialist-3-5: блок обработан',
      );
    } finally {
      this.metrics.observeCoreSpecialistPipelineDuration({
        type: 'insight',
        seconds: (Date.now() - start) / 1000,
      });
    }
  }
}
