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
import { CoreQueueService } from '../../core-queue/core-queue.service';
import {
  CORE_QUEUE_NAMES,
  type SpecialistRoutingJobData,
} from '../../core-queue/queues';
import { RouterService } from '../services/router.service';

/**
 * SBA β-2 — Specialist 3.2 (Knowledge Clone) router-consumer.
 *
 * Consumer очереди `core.specialist-routing` с jobName='3-2-knowledge-clone'.
 * Запускается, когда `RouterService.dispatch` диспатчит блок (signalType=
 * 'fact' с упомянутым employee Person ИЛИ signalType='knowledge_gap')
 * этому специалисту.
 *
 * Логика:
 *   1. Получить block + entities (IdeaBlockEntity → Entity).
 *   2. Для каждого упомянутого Person (через Person.entityId), у которого
 *      `relationship='employee'`, debounce-enqueue
 *      `RebuildKnowledgeProfileJob` (jobId =
 *      `rebuild-knowledge-profile_<personId>`, delay из cfg).
 *   3. Метрики `core_specialist_pipeline_duration_seconds{type='knowledge_profile'}`.
 *
 * НЕ делает: LLM-extraction (это `KnowledgeCloneRebuildWorker`), запись
 * в Person.knowledgeProfile (это Specialist32Service внутри rebuild'а),
 * probe/conflict (это сервисы внутри rebuild'а).
 *
 * Идемпотентность:
 *   - jobId диспатча — `3-2-knowledge-clone_<blockId>` (см. RouterService);
 *   - внутри: enqueueRebuildKnowledgeProfile идемпотентен по
 *     `rebuild-knowledge-profile_<personId>` + debounce.
 */
@Injectable()
export class Specialist32KnowledgeCloneWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(Specialist32KnowledgeCloneWorker.name);
  private worker: Worker<SpecialistRoutingJobData> | null = null;

  static readonly SPECIALIST_NAME = RouterService.SPECIALIST.KNOWLEDGE_CLONE;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
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
        'specialist-3-2: job failed (повтор по политике BullMQ)',
      );
    });
    this.logger.log(
      `Specialist32KnowledgeCloneWorker запущен (${CORE_QUEUE_NAMES.SPECIALIST_ROUTING}, jobName=${Specialist32KnowledgeCloneWorker.SPECIALIST_NAME})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  private async process(job: Job<SpecialistRoutingJobData>): Promise<void> {
    if (job.name !== Specialist32KnowledgeCloneWorker.SPECIALIST_NAME) {
      return;
    }

    const start = Date.now();
    const { blockId, tenantId } = job.data;
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
          'specialist-3-2: блок не найден — skip',
        );
        return;
      }
      if (block.tenantId !== tenantId) {
        this.logger.warn(
          { blockId, expected: tenantId, actual: block.tenantId },
          'specialist-3-2: tenant mismatch — skip',
        );
        return;
      }
      if (block.status !== 'canonical') {
        this.logger.debug(
          { blockId, status: block.status },
          'specialist-3-2: блок ещё не canonical — skip',
        );
        return;
      }

      // Найти Person'ов через IdeaBlockEntity → Entity{type=person} → Person.
      const mentions = await this.prisma.ideaBlockEntity.findMany({
        where: {
          blockId: block.id,
          role: { in: ['subject', 'mentioned'] },
          entity: { type: 'person' },
        },
        select: { entityId: true },
      });
      const entityIds = [...new Set(mentions.map((m) => m.entityId))];
      if (entityIds.length === 0) {
        this.logger.debug(
          { blockId },
          'specialist-3-2: упомянутых Person-entities нет — skip',
        );
        return;
      }

      const persons = await this.prisma.person.findMany({
        where: {
          tenantId,
          entityId: { in: entityIds },
          relationship: 'employee',
          deletedAt: null,
        },
        select: { id: true },
        take: 50,
      });
      if (persons.length === 0) {
        this.logger.debug(
          { blockId, entityIds },
          'specialist-3-2: упомянутые Entity не связаны с Person-сотрудниками — skip',
        );
        return;
      }

      for (const p of persons) {
        try {
          await this.coreQueue.enqueueRebuildKnowledgeProfile({
            tenantId,
            personId: p.id,
            reason: `specialist-3-2:block:${blockId}`,
          });
        } catch (err) {
          this.logger.warn(
            {
              blockId,
              personId: p.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'specialist-3-2: enqueueRebuildKnowledgeProfile упал — пропускаю Person',
          );
        }
      }

      this.logger.log(
        {
          blockId,
          personsDispatched: persons.length,
        },
        'specialist-3-2: enqueue rebuild для затронутых сотрудников',
      );
    } finally {
      this.metrics.observeCoreSpecialistPipelineDuration({
        type: 'knowledge_profile',
        seconds: (Date.now() - start) / 1000,
      });
    }
  }
}
