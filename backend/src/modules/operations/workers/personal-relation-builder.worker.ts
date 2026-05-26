import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type EntityLinkType, Prisma } from '@prisma/client';
import { type Job, Worker } from 'bullmq';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import {
  CORE_QUEUE_NAMES,
  type SpecialistRoutingJobData,
} from '../../core-queue/queues';
import { RouterService } from '../../knowledge-core/services/router.service';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

/**
 * SBA β-8 — PersonalRelationBuilderWorker.
 *
 * Consumer очереди `core.specialist-routing`, jobName='3-12-personal-relation'.
 *
 * Запускается, когда `RouterService.dispatch` диспатчит блок с signalType ∈
 * {team_friction, process_friction, manages, collaborates_with} (последние
 * два — гипотетически, в текущей онтологии нет signalType=manages, но мы
 * закладываемся на расширение). Также реагирует на любой блок, явно
 * передавший этого специалиста.
 *
 * Логика:
 *   1. Загрузить block + его entities (IdeaBlockEntity).
 *   2. Найти ВСЕ упоминания Person'ов (через IdeaBlockEntity → Entity{type=person}).
 *   3. Если ≥ 2 Person'ов и блок про friction — создаём EntityLink с
 *      relationType='conflicted_with' (confidence из block.signalType +
 *      0.6 за упоминание).
 *   4. EntityLink upsert по composite unique
 *      `(fromEntityId, fromType, toEntityId, toType, relationType)`.
 *      Дубли не создаются (см. schema).
 *
 * Confidence threshold = 0.6: ниже — skip (метрика skipped_low_confidence).
 *
 * NB: На β-8 это минимально-жизнеспособный extractor. Полноценный LLM-extract
 * пары участников + roles (manages / reports_to / mentors) — γ-2 (см. ТЗ).
 *
 * Идемпотентность:
 *   - jobId диспатча = `'3-12-personal-relation_<blockId>'`.
 *   - EntityLink composite unique гарантирует, что повторный upsert обновляет
 *     existing link.
 *
 * Метрики:
 *   - `personal_relation_builder_runs_total{tenant_top, result}`.
 */
@Injectable()
export class PersonalRelationBuilderWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PersonalRelationBuilderWorker.name);
  private worker: Worker<SpecialistRoutingJobData> | null = null;

  static readonly SPECIALIST_NAME = RouterService.SPECIALIST.PERSONAL_RELATION;
  private static readonly MIN_CONFIDENCE = 0.6;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
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
        'personal-relation-builder: job failed (повтор по политике BullMQ)',
      );
    });
    this.logger.log(
      `PersonalRelationBuilderWorker запущен (${CORE_QUEUE_NAMES.SPECIALIST_ROUTING}, jobName=${PersonalRelationBuilderWorker.SPECIALIST_NAME})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  private async process(job: Job<SpecialistRoutingJobData>): Promise<void> {
    if (job.name !== PersonalRelationBuilderWorker.SPECIALIST_NAME) {
      return;
    }

    const { blockId, tenantId, signalType } = job.data;
    const tenantTop = resolveOperationsTenantTop(tenantId);

    try {
      const block = await this.prisma.ideaBlock.findUnique({
        where: { id: blockId },
        include: {
          entities: {
            include: {
              entity: { select: { id: true, type: true, name: true } },
            },
          },
        },
      });
      if (!block) {
        this.metrics.incPersonalRelationBuilderRun({
          tenantTop,
          result: 'skipped_no_pair',
        });
        return;
      }
      if (block.tenantId !== tenantId) {
        this.metrics.incPersonalRelationBuilderRun({
          tenantTop,
          result: 'error',
        });
        return;
      }
      if (block.status !== 'canonical') return;

      const personEntities = block.entities.filter(
        (be) => be.entity?.type === 'person',
      );
      if (personEntities.length < 2) {
        this.metrics.incPersonalRelationBuilderRun({
          tenantTop,
          result: 'skipped_no_pair',
        });
        return;
      }

      // На β-8 — упрощённая логика: для friction-блоков создаём
      // 'conflicted_with' между всеми попарно упомянутыми Person'ами.
      const isFriction =
        signalType === 'team_friction' || signalType === 'process_friction';
      if (!isFriction) {
        // На будущее — если придёт другой signalType, пока no-op.
        this.metrics.incPersonalRelationBuilderRun({
          tenantTop,
          result: 'skipped_low_confidence',
        });
        return;
      }

      const relationType: EntityLinkType = 'conflicted_with';
      const confidence = 0.65; // baseline для β-8; γ-2 уточнит через LLM.
      if (confidence < PersonalRelationBuilderWorker.MIN_CONFIDENCE) {
        this.metrics.incPersonalRelationBuilderRun({
          tenantTop,
          result: 'skipped_low_confidence',
        });
        return;
      }

      let linksProcessed = 0;
      for (let i = 0; i < personEntities.length; i++) {
        for (let j = i + 1; j < personEntities.length; j++) {
          const a = personEntities[i]?.entity;
          const b = personEntities[j]?.entity;
          if (!a || !b) continue;
          // Стабилизируем порядок (lex), чтобы (A→B) и (B→A) не плодили дубли.
          const [from, to] = a.id < b.id ? [a, b] : [b, a];
          await this.upsertLink({
            tenantId,
            fromEntityId: from.id,
            toEntityId: to.id,
            relationType,
            confidence,
            blockId: block.id,
            blockSignalType: signalType,
          });
          linksProcessed++;
        }
      }

      this.metrics.incPersonalRelationBuilderRun({
        tenantTop,
        result: linksProcessed > 0 ? 'link_created' : 'skipped_no_pair',
      });
      this.logger.log(
        { blockId: block.id, linksProcessed, signalType },
        'personal-relation-builder: обработан блок',
      );
    } catch (err) {
      this.metrics.incPersonalRelationBuilderRun({
        tenantTop,
        result: 'error',
      });
      throw err;
    }
  }

  private async upsertLink(args: {
    tenantId: string;
    fromEntityId: string;
    toEntityId: string;
    relationType: EntityLinkType;
    confidence: number;
    blockId: string;
    blockSignalType: string;
  }): Promise<void> {
    const explanation = `Авто-извлечение из блока signalType=${args.blockSignalType} (β-8 PersonalRelationBuilder).`;
    await this.prisma.entityLink.upsert({
      where: {
        fromEntityId_fromType_toEntityId_toType_relationType: {
          fromEntityId: args.fromEntityId,
          fromType: 'entity',
          toEntityId: args.toEntityId,
          toType: 'entity',
          relationType: args.relationType,
        },
      },
      create: {
        tenantId: args.tenantId,
        fromEntityId: args.fromEntityId,
        fromType: 'entity',
        toEntityId: args.toEntityId,
        toType: 'entity',
        relationType: args.relationType,
        confidence: new Prisma.Decimal(args.confidence.toFixed(3)),
        explanation,
        createdBy: 'linker',
        status: 'active',
        properties: {
          sourceBlockId: args.blockId,
          sourceSignalType: args.blockSignalType,
        } as Prisma.InputJsonValue,
      },
      update: {
        confidence: new Prisma.Decimal(args.confidence.toFixed(3)),
        explanation,
        status: 'active',
        properties: {
          sourceBlockId: args.blockId,
          sourceSignalType: args.blockSignalType,
        } as Prisma.InputJsonValue,
      },
    });
  }
}
