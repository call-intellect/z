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
import { Specialist38HelpfulnessService } from '../services/specialist-3-8-helpfulness.service';

/**
 * SBA Wave 2 — Specialist 3.8 (Helpfulness Agent) worker.
 *
 * Consumer `core.specialist-routing` jobName='3-8-helpfulness'. Делегирует в
 * `Specialist38HelpfulnessService.processBlock`.
 *
 * Триггер: RouterService должен начать диспатчить блоки с signalType
 * ∈ {help_provided, proactive_hint, mentoring, emotional_support,
 *    constructive_feedback, question_unanswered, question_acknowledged_no_action,
 *    helped_by, helped_to, thanks_explicit, task_comment, task_mention}
 * на этот специалист (см. router.service.ts — расширение mapping'а в Wave 2).
 *
 * Дополнительно специалист может срабатывать на signalType=question (когда уже
 * детектированы 48ч без ответа — это question_unanswered), но это решает
 * RouterService.
 *
 * Идемпотентность через jobId `3-8-helpfulness_<blockId>` (формируется в
 * RouterService.dispatch).
 */
@Injectable()
export class Specialist38HelpfulnessWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(Specialist38HelpfulnessWorker.name);
  private worker: Worker<SpecialistRoutingJobData> | null = null;

  /** jobName-фильтр консумера. */
  static readonly SPECIALIST_NAME = '3-8-helpfulness';

  /**
   * SignalType, которые специалист реально обрабатывает. Дублирует фильтр
   * RouterService — на стороне consumer'а cheap-фильтр без обращения к БД.
   */
  static readonly ALLOWED_SIGNAL_TYPES: ReadonlySet<string> = new Set([
    // 7 helpfulness-типов (см. SignalType enum, добавлены в Sprint 1)
    'help_provided',
    'proactive_hint',
    'mentoring',
    'emotional_support',
    'constructive_feedback',
    'question_unanswered',
    'question_acknowledged_no_action',
    // 3 gamification-типа — тоже про помощь / благодарность
    'helped_by',
    'helped_to',
    'thanks_explicit',
    // блоки из tracker (комментарии в задачах) — главный источник helpfulness
    'task_comment',
    'task_mention',
  ]);

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Specialist38HelpfulnessService)
    private readonly svc: Specialist38HelpfulnessService,
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
        'specialist-3-8: job failed (повтор по политике BullMQ)',
      );
    });
    this.logger.log(
      `Specialist38HelpfulnessWorker запущен (${CORE_QUEUE_NAMES.SPECIALIST_ROUTING}, jobName=${Specialist38HelpfulnessWorker.SPECIALIST_NAME})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  private async process(job: Job<SpecialistRoutingJobData>): Promise<void> {
    if (job.name !== Specialist38HelpfulnessWorker.SPECIALIST_NAME) return;
    const start = Date.now();
    const { blockId, tenantId, signalType } = job.data;

    // Cheap-фильтр по signalType до запроса в БД.
    if (
      signalType &&
      !Specialist38HelpfulnessWorker.ALLOWED_SIGNAL_TYPES.has(signalType)
    ) {
      this.logger.debug(
        { blockId, signalType },
        'specialist-3-8: signalType вне области специалиста — skip',
      );
      return;
    }

    try {
      const block = await this.prisma.ideaBlock.findUnique({
        where: { id: blockId },
        select: {
          id: true,
          tenantId: true,
          status: true,
          signalType: true,
        },
      });
      if (!block) {
        this.logger.debug(
          { blockId },
          'specialist-3-8: блок не найден — skip',
        );
        return;
      }
      if (block.tenantId !== tenantId) {
        this.logger.warn(
          { blockId, expected: tenantId, actual: block.tenantId },
          'specialist-3-8: tenant mismatch — skip',
        );
        return;
      }
      if (block.status !== 'canonical') {
        this.logger.debug(
          { blockId, status: block.status },
          'specialist-3-8: блок не canonical — skip',
        );
        return;
      }
      if (
        !Specialist38HelpfulnessWorker.ALLOWED_SIGNAL_TYPES.has(
          block.signalType,
        )
      ) {
        // DB-уточнение, если в payload signalType отсутствовал.
        return;
      }

      const result = await this.svc.processBlock({ tenantId, blockId });
      if (result) {
        this.logger.log(
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
