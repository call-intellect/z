import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Job } from 'bullmq';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';
import { type SpecialistRoutingJobData } from '../../core-queue/queues';
import { RouterService } from '../services/router.service';

@Injectable()
export class Specialist32KnowledgeCloneWorker {
  private readonly logger = new Logger(Specialist32KnowledgeCloneWorker.name);

  static readonly SPECIALIST_NAME = RouterService.SPECIALIST.KNOWLEDGE_CLONE;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async handle(job: Job<SpecialistRoutingJobData>): Promise<void> {
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
        this.logger.debug({ blockId }, 'specialist-3-2: блок не найден — skip');
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist32KnowledgeCloneWorker.SPECIALIST_NAME,
          reason: 'block_not_found',
        });
        return;
      }
      if (block.tenantId !== tenantId) {
        this.logger.warn(
          { blockId, expected: tenantId, actual: block.tenantId },
          'specialist-3-2: tenant mismatch — skip',
        );
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist32KnowledgeCloneWorker.SPECIALIST_NAME,
          reason: 'tenant_mismatch',
        });
        return;
      }
      if (block.status !== 'canonical') {
        this.logger.debug(
          { blockId, status: block.status },
          'specialist-3-2: блок ещё не canonical — skip',
        );
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist32KnowledgeCloneWorker.SPECIALIST_NAME,
          reason: 'not_canonical',
        });
        return;
      }

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
        this.logger.debug({ blockId }, 'specialist-3-2: упомянутых Person-entities нет — skip');
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist32KnowledgeCloneWorker.SPECIALIST_NAME,
          reason: 'signal_out_of_scope',
        });
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
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist32KnowledgeCloneWorker.SPECIALIST_NAME,
          reason: 'signal_out_of_scope',
        });
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

      this.logger.debug(
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
