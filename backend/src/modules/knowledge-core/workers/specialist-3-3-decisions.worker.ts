import {
  Inject,
  Injectable,
  Logger,
  Optional,
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
// Pulse Wave 6 §6.8 — Decision-Hygiene-Scorer enqueue после processBlock.
// Optional: spec-тесты Specialist33Worker не передают DashboardModule в DI,
// и поведение должно остаться идентичным.
import { DashboardQueueService } from '../../dashboard/services/dashboard-queue.service';
import { RouterService } from '../services/router.service';
import { Specialist33Service } from '../services/specialist-3-3-decisions.service';

/**
 * SBA β-3 — Specialist 3.3 (Decisions) — consumer `core.specialist-routing`
 * с jobName='3-3-decisions'.
 *
 * Запускается, когда `RouterService.dispatch` диспатчит блок (`signalType ∈
 * { 'decision', 'rationale', 'decision_basis' }`) этому специалисту.
 * Воркер фильтрует jobs других специалистов по `job.name`.
 *
 * Логика делегируется в `Specialist33Service.processBlock`. См. sub-TZ
 * `plans/tz/2026-05-21-sba-beta-3-specialist-3-3-decisions.md` §5.
 *
 * Идемпотентность:
 *   - jobId диспатча = `'3-3-decisions_<blockId>'` (см. RouterService).
 *   - Внутри Specialist33Service — KNN-dedupe + supersede-detect перед
 *     созданием Decision, плюс triage всегда идёт через CurationItem
 *     (decision в CURATION_CRITICAL_TYPES_DEFAULT — deep review).
 *
 * Метрики:
 *   - `core_specialist_pipeline_duration_seconds{type='decision'}`.
 *
 * Concurrency=2 — баланс между параллелизмом и LLM rate-limit'ами,
 * совпадает с Specialist 3.1.
 */
@Injectable()
export class Specialist33DecisionsWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(Specialist33DecisionsWorker.name);
  private worker: Worker<SpecialistRoutingJobData> | null = null;

  /** Имя специалиста (jobName-фильтр). Совпадает с RouterService.SPECIALIST.DECISIONS. */
  static readonly SPECIALIST_NAME = RouterService.SPECIALIST.DECISIONS;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Specialist33Service) private readonly svc: Specialist33Service,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    // Pulse Wave 6 §6.8 — Decision-Hygiene producer. Best-effort: если
    // DashboardModule не подключён (старые spec-тесты) — просто skip enqueue.
    @Optional()
    @Inject(DashboardQueueService)
    private readonly dashboardQueue?: DashboardQueueService,
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
        'specialist-3-3: job failed (повтор по политике BullMQ)',
      );
    });
    this.logger.log(
      `Specialist33DecisionsWorker запущен (${CORE_QUEUE_NAMES.SPECIALIST_ROUTING}, jobName=${Specialist33DecisionsWorker.SPECIALIST_NAME})`,
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
    if (job.name !== Specialist33DecisionsWorker.SPECIALIST_NAME) {
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
          'specialist-3-3: блок не найден — skip',
        );
        return;
      }
      if (block.tenantId !== tenantId) {
        this.logger.warn(
          { blockId, expected: tenantId, actual: block.tenantId },
          'specialist-3-3: tenant mismatch — skip',
        );
        return;
      }
      if (block.status !== 'canonical') {
        this.logger.debug(
          { blockId, status: block.status },
          'specialist-3-3: блок ещё не canonical — skip',
        );
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
        return;
      }

      await this.svc.processBlock({ tenantId, blockId });

      this.logger.log(
        { blockId, signalType: block.signalType },
        'specialist-3-3: блок обработан',
      );

      // Pulse Wave 6 §6.8 — enqueue Decision-Hygiene для каждого
      // не классифицированного Decision этого блока. Запрос лёгкий
      // (по индексу `sourceIdeaBlockId` или GIN по `sourceBlockIds`).
      // Не критично к точности счёта — worker сам skip'ает уже
      // классифицированные. Не валим основной поток на ошибке.
      if (this.dashboardQueue) {
        await this.enqueueHygieneForBlock({ tenantId, blockId }).catch(
          (err) => {
            this.logger.warn(
              {
                blockId,
                err: err instanceof Error ? err.message : String(err),
              },
              'specialist-3-3: enqueueHygiene упал — пропуск',
            );
          },
        );
      }
    } finally {
      this.metrics.observeCoreSpecialistPipelineDuration({
        type: 'decision',
        seconds: (Date.now() - start) / 1000,
      });
    }
  }

  /**
   * Pulse Wave 6 §6.8 — собирает Decision'ы данного блока (через legacy
   * `sourceIdeaBlockId` и через GIN-массив `sourceBlockIds`) и enqueue'ит
   * Decision-Hygiene для каждого с `reversibility=null`. Идемпотентно
   * по `dashboard-queue:decision-hygiene:<decisionId>`.
   */
  private async enqueueHygieneForBlock(args: {
    tenantId: string;
    blockId: string;
  }): Promise<void> {
    const dq = this.dashboardQueue;
    if (!dq) return;
    const decisions = await this.prisma.decision.findMany({
      where: {
        tenantId: args.tenantId,
        reversibility: null,
        OR: [
          { sourceIdeaBlockId: args.blockId },
          { sourceBlockIds: { has: args.blockId } },
        ],
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
