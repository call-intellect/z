import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { type Entity } from '@prisma/client';
import { type Job, Worker } from 'bullmq';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { CORE_QUEUE_NAMES, type EntityResolverJobData } from '../../core-queue/queues';
import { WorkerOrgGate } from '../../core-queue/worker-org-gate';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { ENTITY_ARCHIVED } from '../../tables/events/entity-sync.events';
import { EntityMergeService } from '../services/entity-merge.service';
import { EntityResolutionService } from '../services/entity-resolution.service';
import type { IdeaBlockUpdatedEvent } from '../services/projection-rebuilder.service';

@Injectable()
export class EntityResolverWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EntityResolverWorker.name);
  private worker: Worker<EntityResolverJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(EntityMergeService) private readonly merger: EntityMergeService,
    // Б29 [K6] — negative-cache distinct-пар: на verdict='distinct' помечаем
    // пару, чтобы cron не отправлял её LLM-арбитру каждые 5 минут.
    @Inject(EntityResolutionService)
    private readonly resolution: EntityResolutionService,
    @Inject(WorkerOrgGate) private readonly gate: WorkerOrgGate,
    @Optional()
    @Inject(EventEmitter2)
    private readonly eventEmitter?: EventEmitter2,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<EntityResolverJobData>(
      CORE_QUEUE_NAMES.ENTITY_RESOLVER,
      async (job) =>
        this.pipe.job(SystemLogPipeline.KNOWLEDGE_GRAPH, 'kc.entity-resolver', job, () =>
          this.process(job),
        ),
      {
        connection: this.redis.client,
        concurrency: 1,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.onJobFailed(job ?? null, err).catch((e) => {
        this.logger.error(`onJobFailed: ${e instanceof Error ? e.message : String(e)}`);
      });
    });
    this.logger.debug(`EntityResolverWorker запущен (${CORE_QUEUE_NAMES.ENTITY_RESOLVER})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  private async process(job: Job<EntityResolverJobData>): Promise<void> {
    const { entityId } = job.data;
    const entity = await this.prisma.entity.findFirst({ where: { id: entityId } });
    if (!entity) {
      this.logger.warn({ entityId }, 'entity-resolver: Entity не найдена — skip');
      return;
    }
    if (entity.mergedIntoId !== null) {
      this.logger.debug({ entityId }, 'entity-resolver: уже merged_into — skip');
      return;
    }

    await this.gate.checkOrThrow(entity.tenantId, 'entity-resolver');

    const mergeThreshold = this.cfg.knowledgeCore.entityMergeThreshold;
    const candidates = await this.merger.findCandidates({
      tenantId: entity.tenantId,
      entityId: entity.id,
      threshold: mergeThreshold,
    });
    if (candidates.length === 0) {
      this.logger.debug({ entityId }, 'entity-resolver: кандидатов нет');
      return;
    }

    const recentBlocks = await this.loadRecentBlocks(entity.id);

    for (const c of candidates) {
      const candRecent = await this.loadRecentBlocks(c.candidate.id);
      const verdict = await this.merger.judgeMerge({
        tenantId: entity.tenantId,
        entity,
        candidate: c.candidate,
        recentBlocks,
        candidateRecentBlocks: candRecent,
      });
      if (verdict.verdict === 'distinct') {
        // Б29 [K6] — персистим негативный вердикт: пара (entity, candidate)
        // признана РАЗНЫМИ. Cron исключит её из выборки кандидатов до TTL,
        // иначе арбитр пересудил бы ту же пару каждые 5 минут. Best-effort.
        await this.resolution
          .markEntityPairDistinct(entity.id, c.candidate.id)
          .catch(() => undefined);
        continue;
      }
      // verdict='merge'
      this.metrics?.observeEntityMergeConfidenceGap(c.similarity - mergeThreshold);
      try {
        await this.applyMerge({
          entity,
          targetId: verdict.canonicalId,
          explanation: verdict.explanation,
        });
        return;
      } catch (err) {
        this.logger.warn(
          {
            entityId: entity.id,
            targetId: verdict.canonicalId,
            err: err instanceof Error ? err.message : String(err),
          },
          'entity-resolver: applyMerge упал — пробуем следующего кандидата',
        );
        continue;
      }
    }
    this.logger.debug(
      { entityId, candidates: candidates.length },
      'entity-resolver: ни один кандидат не merge — оставляем как есть',
    );
  }

  private async loadRecentBlocks(entityId: string) {
    const rows = await this.prisma.ideaBlockEntity.findMany({
      where: { entityId },
      include: { block: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    return rows.map((r) => r.block);
  }

  private async applyMerge(args: {
    entity: Entity;
    targetId: string;
    explanation: string;
  }): Promise<void> {
    const { entity, targetId } = args;
    if (targetId === entity.id) {
      throw new Error(`entity-resolver: targetId == entityId (${entity.id}) — abort`);
    }

    await this.merger.mergeEntities({
      tenantId: entity.tenantId,
      fromEntityId: entity.id,
      intoEntityId: targetId,
      actor: { source: 'auto-resolver', explanation: args.explanation },
    });

    this.logger.debug(
      { entityId: entity.id, targetId, explanation: args.explanation },
      'entity-resolver: merged',
    );

    if (this.eventEmitter) {
      try {
        this.eventEmitter.emit(ENTITY_ARCHIVED, {
          tenantId: entity.tenantId,
          entityId: entity.id,
          entityType: entity.type,
        });
      } catch (err) {
        this.logger.warn(
          {
            entityId: entity.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'entity-resolver: emit entity.archived упал — пропускаем (best-effort)',
        );
      }
    }

    await this.emitProjectionsRebuildForEntityMerge({
      tenantId: entity.tenantId,
      targetEntityId: targetId,
    });
  }

  private async emitProjectionsRebuildForEntityMerge(args: {
    tenantId: string;
    targetEntityId: string;
  }): Promise<void> {
    if (!this.eventEmitter) return;
    try {
      const rows = await this.prisma.ideaBlockEntity.findMany({
        where: { entityId: args.targetEntityId },
        select: { blockId: true },
      });
      const now = Date.now();
      for (const r of rows) {
        const event: IdeaBlockUpdatedEvent = {
          tenantId: args.tenantId,
          blockId: r.blockId,
          changeKind: 'entity_merged',
          emittedAt: now,
        };
        try {
          this.eventEmitter.emit('idea_block.updated', event);
        } catch (err) {
          this.logger.warn(
            {
              blockId: r.blockId,
              err: err instanceof Error ? err.message : String(err),
            },
            'entity-resolver: emit idea_block.updated упал — пропускаем блок',
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        {
          targetEntityId: args.targetEntityId,
          err: err instanceof Error ? err.message : String(err),
        },
        'entity-resolver: не удалось собрать список блоков для emit — пропускаем',
      );
    }
  }

  private async onJobFailed(job: Job<EntityResolverJobData> | null, err: Error): Promise<void> {
    if (!job) return;
    if (job.attemptsMade < (job.opts.attempts ?? 5)) return;
    this.logger.error(
      { entityId: job.data.entityId, attempts: job.attemptsMade, err: err.message },
      'entity-resolver: финальный fail после всех ретраев',
    );
  }
}
