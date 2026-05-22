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
import { Specialist31Service } from '../services/specialist-3-1-regulations.service';

/**
 * SBA α-7 — Specialist 3.1 (Regulations) — consumer `core.specialist-routing`
 * с jobName='3-1-regulations'.
 *
 * Запускается, когда `RouterService.dispatch` диспатчит блок (`signalType=
 * 'regulation'` или `'process_step'`) этому специалисту. Воркер фильтрует
 * jobs других специалистов по `job.name`.
 *
 * Логика:
 *   1. Загрузить block + evidence + entities.
 *   2. Проверить tenant + status ('canonical' — только из BlockDistillWorker'а
 *      опубликованные блоки участвуют в специалистах; draft пропускаем).
 *   3. По signalType вызвать соответствующий метод Specialist31Service.
 *
 * Идемпотентность:
 *   - jobId диспатча = `'3-1-regulations_<blockId>'` (см. RouterService).
 *   - Внутри Specialist31Service — upsert по (tenantId, name), так что
 *     повторный запуск с тем же блоком безопасен.
 *
 * Метрики:
 *   - `core_specialist_pipeline_duration_seconds{type='regulation'}` —
 *     длительность полного цикла специалиста.
 *
 * Concurrency=2 — баланс между параллелизмом и LLM rate-limit'ами.
 */
@Injectable()
export class Specialist31RegulationsWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(Specialist31RegulationsWorker.name);
  private worker: Worker<SpecialistRoutingJobData> | null = null;

  /**
   * Имя специалиста (jobName-фильтр). Должно совпадать со значением
   * `RouterService.SPECIALIST.REGULATIONS`.
   */
  static readonly SPECIALIST_NAME = RouterService.SPECIALIST.REGULATIONS;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Specialist31Service) private readonly svc: Specialist31Service,
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
        'specialist-3-1: job failed (повтор по политике BullMQ)',
      );
    });
    this.logger.log(
      `Specialist31RegulationsWorker запущен (${CORE_QUEUE_NAMES.SPECIALIST_ROUTING}, jobName=${Specialist31RegulationsWorker.SPECIALIST_NAME})`,
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
    if (job.name !== Specialist31RegulationsWorker.SPECIALIST_NAME) {
      return;
    }

    const start = Date.now();
    const { blockId, tenantId } = job.data;

    try {
      const block = await this.prisma.ideaBlock.findUnique({
        where: { id: blockId },
        include: {
          evidence: true,
          entities: true,
        },
      });
      if (!block) {
        this.logger.debug(
          { blockId },
          'specialist-3-1: блок не найден — skip',
        );
        return;
      }
      if (block.tenantId !== tenantId) {
        this.logger.warn(
          { blockId, expected: tenantId, actual: block.tenantId },
          'specialist-3-1: tenant mismatch — skip',
        );
        return;
      }
      if (block.status !== 'canonical') {
        this.logger.debug(
          { blockId, status: block.status },
          'specialist-3-1: блок ещё не canonical — skip',
        );
        return;
      }

      // Делегация по signalType. Specialist31Service сам fallback'ит по kind.
      if (block.signalType === 'regulation') {
        await this.svc.processRegulationBlock(block);
      } else if (block.signalType === 'process_step') {
        await this.svc.processProcessStepBlock(block);
      } else {
        this.logger.debug(
          { blockId, signalType: block.signalType },
          'specialist-3-1: signalType вне области специалиста — skip',
        );
        return;
      }

      this.logger.log(
        {
          blockId,
          signalType: block.signalType,
        },
        'specialist-3-1: блок обработан',
      );
    } finally {
      this.metrics.observeCoreSpecialistPipelineDuration({
        type: 'regulation',
        seconds: (Date.now() - start) / 1000,
      });
    }
  }
}
