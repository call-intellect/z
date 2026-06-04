import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Job } from 'bullmq';


import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { type SprintHelperJobData } from '../../core-queue/queues';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { SprintHelperService } from '../services/sprint-helper.service';

/**
 * Sprints (2026-05-27) — Specialist 3-13 «Помощник по спринтам» handler.
 *
 * Handler очереди `core.specialist-routing` с jobName='3-13-sprint-helper'.
 * Вызывается из `SpecialistRoutingDispatcherWorker.dispatch`. В отличие от
 * остальных специалистов работает с payload `SprintHelperJobData` (по `cycleId`,
 * не по блоку). jobId дедуп — `3-13-sprint-helper_<cycleId>` (в CoreQueueService).
 *
 * Делегирует логику в `SprintHelperService.runForCycle`.
 */
@Injectable()
export class SprintHelperWorker {
  private readonly logger = new Logger(SprintHelperWorker.name);

  /** Ключ маршрутизации диспетчера (jobName в очереди). */
  static readonly JOB_NAME = '3-13-sprint-helper';

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(SprintHelperService) private readonly svc: SprintHelperService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async handle(job: Job<SprintHelperJobData>): Promise<void> {
    await this.pipe.job(
      SystemLogPipeline.KNOWLEDGE_GRAPH,
      'kc.sprint-helper',
      job,
      () => this.process(job),
    );
  }

  private async process(job: Job<SprintHelperJobData>): Promise<void> {
    const { cycleId, tenantId, reason = 'cron' } = job.data;
    if (!cycleId || !tenantId) {
      // Sprint-helper работает по cycleId (не по блоку); пустой payload —
      // нечего обрабатывать. Метрика skip, чтобы не сливалось с success.
      this.metrics.incCoreSpecialistSkipped({
        specialist: SprintHelperWorker.JOB_NAME,
        reason: 'signal_out_of_scope',
      });
      return;
    }
    try {
      const { created, reused } = await this.svc.runForCycle({
        cycleId,
        tenantId,
        reason,
      });
      this.logger.log(
        { cycleId, tenantId, reason, created, reused },
        `sprint-helper: завершено — создано ${created}, повтор ${reused}`,
      );
    } catch (err) {
      // SprintHelperService уже не бросает — на всякий случай ловим.
      this.logger.error(
        {
          cycleId,
          tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'sprint-helper: неожиданная ошибка',
      );
    }
  }
}
