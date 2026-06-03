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
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { RouterService } from '../services/router.service';
import { Specialist39ExperimentsService } from '../services/specialist-3-9-experiments.service';

/**
 * SBA β-6 — Experiment Tracker (Specialist 3.9) — consumer
 * `core.specialist-routing` с jobName='3-9-experiments'.
 *
 * Запускается, когда `RouterService.dispatch` диспатчит блок с signalType ∈
 * { hypothesis, result, lesson } этому специалисту. Воркер фильтрует jobs
 * других специалистов по `job.name` (паттерн §5 контракта зонтичного).
 *
 * Логика делегируется в `Specialist39ExperimentsService.processBlock`.
 *
 * Идемпотентность:
 *   - jobId диспатча = `'3-9-experiments_<blockId>'` (см. CoreQueueService).
 *   - В сервисе: повторный заход того же blockId — обновляет существующий
 *     Experiment (если блок уже в sourceBlockIds[]) и создаёт новую
 *     ExperimentVersion (snapshot).
 *
 * Метрики:
 *   - `core_specialist_pipeline_duration_seconds{type='experiment'}`.
 *   - `experiment_detector_runs_total{tenant_top, result}` — внутри сервиса.
 *
 * Concurrency=2 — баланс между параллелизмом и LLM rate-limit'ами; совпадает
 * с другими специалистами Слоя 3.
 */
@Injectable()
export class ExperimentDetectorWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ExperimentDetectorWorker.name);
  private worker: Worker<SpecialistRoutingJobData> | null = null;

  /** jobName-фильтр. Совпадает с RouterService.SPECIALIST.EXPERIMENT_TRACKER. */
  static readonly SPECIALIST_NAME = RouterService.SPECIALIST.EXPERIMENT_TRACKER;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Specialist39ExperimentsService)
    private readonly svc: Specialist39ExperimentsService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<SpecialistRoutingJobData>(
      CORE_QUEUE_NAMES.SPECIALIST_ROUTING,
      async (job) =>
        this.pipe.job(SystemLogPipeline.KNOWLEDGE_GRAPH, 'kc.experiment-detector', job, () =>
          this.process(job),
        ),
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
        'experiment-detector: job failed (повтор по политике BullMQ)',
      );
    });
    this.logger.log(
      `ExperimentDetectorWorker запущен (${CORE_QUEUE_NAMES.SPECIALIST_ROUTING}, jobName=${ExperimentDetectorWorker.SPECIALIST_NAME})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  private async process(job: Job<SpecialistRoutingJobData>): Promise<void> {
    if (job.name !== ExperimentDetectorWorker.SPECIALIST_NAME) {
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
          'experiment-detector: блок не найден — skip',
        );
        return;
      }
      if (block.tenantId !== tenantId) {
        this.logger.warn(
          { blockId, expected: tenantId, actual: block.tenantId },
          'experiment-detector: tenant mismatch — skip',
        );
        return;
      }
      if (block.status !== 'canonical') {
        this.logger.debug(
          { blockId, status: block.status },
          'experiment-detector: блок ещё не canonical — skip',
        );
        return;
      }
      const allowed = new Set(['hypothesis', 'result', 'lesson']);
      if (!allowed.has(block.signalType)) {
        this.logger.debug(
          { blockId, signalType: block.signalType },
          'experiment-detector: signalType вне области специалиста — skip',
        );
        return;
      }

      await this.svc.processBlock({ tenantId, blockId });
    } finally {
      this.metrics.observeCoreSpecialistPipelineDuration({
        type: 'experiment',
        seconds: (Date.now() - start) / 1000,
      });
    }
  }
}
