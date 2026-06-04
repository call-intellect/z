import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Job } from 'bullmq';


import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { type SpecialistRoutingJobData } from '../../core-queue/queues';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { RouterService } from '../services/router.service';
import { Specialist39ExperimentsService } from '../services/specialist-3-9-experiments.service';

/**
 * SBA β-6 — Experiment Tracker (Specialist 3.9) — handler
 * `core.specialist-routing` с jobName='3-9-experiments'.
 *
 * Вызывается из `SpecialistRoutingDispatcherWorker.dispatch` для блоков с
 * signalType ∈ { hypothesis, result, lesson }, которые `RouterService.dispatch`
 * диспатчит этому специалисту. Маршрутизацию по jobName делает диспетчер.
 *
 * Логика делегируется в `Specialist39ExperimentsService.processBlock` и
 * оборачивается в `PipelineRunner.job` для системного лог-пайплайна.
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
 */
@Injectable()
export class ExperimentDetectorWorker {
  private readonly logger = new Logger(ExperimentDetectorWorker.name);

  /** Имя специалиста (ключ маршрутизации диспетчера). Совпадает с RouterService.SPECIALIST.EXPERIMENT_TRACKER. */
  static readonly SPECIALIST_NAME = RouterService.SPECIALIST.EXPERIMENT_TRACKER;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Specialist39ExperimentsService)
    private readonly svc: Specialist39ExperimentsService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async handle(job: Job<SpecialistRoutingJobData>): Promise<void> {
    await this.pipe.job(
      SystemLogPipeline.KNOWLEDGE_GRAPH,
      'kc.experiment-detector',
      job,
      () => this.process(job),
    );
  }

  private async process(job: Job<SpecialistRoutingJobData>): Promise<void> {
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
