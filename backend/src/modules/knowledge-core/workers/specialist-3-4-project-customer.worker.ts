import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Job } from 'bullmq';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';
import { type SpecialistRoutingJobData } from '../../core-queue/queues';
import { RouterService } from '../services/router.service';

@Injectable()
export class Specialist34ProjectCustomerWorker {
  private readonly logger = new Logger(Specialist34ProjectCustomerWorker.name);

  private static readonly RELEVANT_ENTITY_TYPES = [
    'customer',
    'vendor',
    'project',
    'product',
    'client',
  ] as const;

  static readonly SPECIALIST_NAME = RouterService.SPECIALIST.PROJECT_CUSTOMER;

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
        this.logger.debug({ blockId }, 'specialist-3-4: блок не найден — skip');
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist34ProjectCustomerWorker.SPECIALIST_NAME,
          reason: 'block_not_found',
        });
        return;
      }
      if (block.tenantId !== tenantId) {
        this.logger.warn(
          { blockId, expected: tenantId, actual: block.tenantId },
          'specialist-3-4: tenant mismatch — skip',
        );
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist34ProjectCustomerWorker.SPECIALIST_NAME,
          reason: 'tenant_mismatch',
        });
        return;
      }
      if (block.status !== 'canonical') {
        this.logger.debug(
          { blockId, status: block.status },
          'specialist-3-4: блок ещё не canonical — skip',
        );
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist34ProjectCustomerWorker.SPECIALIST_NAME,
          reason: 'not_canonical',
        });
        return;
      }

      const mentions = await this.prisma.ideaBlockEntity.findMany({
        where: {
          blockId: block.id,
          entity: {
            type: {
              in: [...Specialist34ProjectCustomerWorker.RELEVANT_ENTITY_TYPES],
            },
          },
        },
        select: { entityId: true },
      });
      const entityIds = [...new Set(mentions.map((m) => m.entityId))];
      if (entityIds.length === 0) {
        this.logger.debug({ blockId }, 'specialist-3-4: нет релевантных entity-упоминаний — skip');
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist34ProjectCustomerWorker.SPECIALIST_NAME,
          reason: 'signal_out_of_scope',
        });
        return;
      }

      const cards = await this.prisma.card.findMany({
        where: {
          tenantId,
          deletedAt: null,
          OR: [{ entityId: { in: entityIds } }, { relatedEntityIds: { hasSome: entityIds } }],
        },
        select: { id: true },
        // Б42 [K3]: детерминированный отбор при take. Без orderBy Postgres
        // отдаёт произвольные строки → часть карточек систематически не
        // получала бы rollup. Стабильный порядок: давно не подтверждённые
        // (самые «протухшие» — приоритет rollup'у), затем id для тай-брейка.
        orderBy: [{ lastConfirmedAt: 'asc' }, { id: 'asc' }],
        // Защита от вырожденных tenant'ов с сотнями тысяч карточек:
        // на один блок более 200 карточек — это сигнал плохой онтологии.
        take: 200,
      });

      if (cards.length === 0) {
        this.logger.debug(
          { blockId, entityIds },
          'specialist-3-4: блок ссылается на entity, но Card не найдено — skip',
        );
        this.metrics.incCoreSpecialistSkipped({
          specialist: Specialist34ProjectCustomerWorker.SPECIALIST_NAME,
          reason: 'signal_out_of_scope',
        });
        return;
      }

      for (const c of cards) {
        try {
          await this.coreQueue.enqueueCardRollupV2(c.id, {
            reason: `specialist-3-4:block:${blockId}`,
          });
        } catch (err) {
          this.logger.warn(
            {
              blockId,
              cardId: c.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'specialist-3-4: enqueueCardRollupV2 упал — продолжаем по остальным',
          );
        }
      }

      this.logger.debug(
        {
          blockId,
          entityIds: entityIds.length,
          cardsDispatched: cards.length,
        },
        'specialist-3-4: dispatch rollup для затронутых карточек',
      );
    } finally {
      this.metrics.observeCoreSpecialistPipelineDuration({
        type: 'card',
        seconds: (Date.now() - start) / 1000,
      });
    }
  }
}
