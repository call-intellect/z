import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Entity, Prisma } from '@prisma/client';
import { type Job, Worker } from 'bullmq';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import {
  CORE_QUEUE_NAMES,
  type EntityResolverJobData,
} from '../../core-queue/queues';
import { WorkerOrgGate } from '../../core-queue/worker-org-gate';
import { EntityMergeService } from '../services/entity-merge.service';

/**
 * Entity-resolver worker (`core.entity-resolver` consumer).
 *
 * Шаги на job `{ entityId }`:
 *   1. findUnique Entity. Если null → skip.
 *   2. Идемпотентность: entity.mergedIntoId !== null → skip (уже объединена).
 *   3. KNN cosine top-5 кандидатов того же tenantId/type, embedding IS NOT NULL,
 *      mergedIntoId IS NULL, sim > ENTITY_MERGE_THRESHOLD.
 *   4. Если кандидатов нет — return.
 *   5. Для каждого (по убыванию similarity) — judgeMerge с контекстом блоков.
 *      На первый verdict='merge' — Prisma-транзакция:
 *        - Защита: target.mergedIntoId === null, entity.mergedIntoId === null (race).
 *        - Защита: canonicalId реально присутствует в списке кандидатов.
 *        - entity.mergedIntoId = target.id, updatedAt=now.
 *        - target.mentionsCount += entity.mentionsCount.
 *        - target.aliases = union(target.aliases, [entity.canonicalName, ...entity.aliases]).
 *        - Перенос IdeaBlockEntity entityId=entity.id → entityId=target.id;
 *          composite PK (blockId, entityId) — try update, на P2002 → delete старую.
 *
 * Concurrency=1: cron + on-event могут пересекаться, но операция merge меняет
 * глобальное состояние. Обрабатываем серийно, чтобы не было race условий
 * между двумя параллельными jobs для одной пары Entity.
 */
@Injectable()
export class EntityResolverWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EntityResolverWorker.name);
  private worker: Worker<EntityResolverJobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(EntityMergeService) private readonly merger: EntityMergeService,
    @Inject(WorkerOrgGate) private readonly gate: WorkerOrgGate,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<EntityResolverJobData>(
      CORE_QUEUE_NAMES.ENTITY_RESOLVER,
      async (job) => this.process(job),
      {
        connection: this.redis.client,
        concurrency: 1,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.onJobFailed(job ?? null, err).catch((e) => {
        this.logger.error(
          `onJobFailed: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
    });
    this.logger.log(
      `EntityResolverWorker запущен (${CORE_QUEUE_NAMES.ENTITY_RESOLVER})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  // ─────────────────────────── core ────────────────────────────────────────

  private async process(job: Job<EntityResolverJobData>): Promise<void> {
    const { entityId } = job.data;
    const entity = await this.prisma.entity.findUnique({ where: { id: entityId } });
    if (!entity) {
      this.logger.warn({ entityId }, 'entity-resolver: Entity не найдена — skip');
      return;
    }
    if (entity.mergedIntoId !== null) {
      this.logger.debug(
        { entityId },
        'entity-resolver: уже merged_into — skip',
      );
      return;
    }

    // Org-Admin Фаза 7: проверка тумблера.
    await this.gate.checkOrThrow(entity.tenantId, 'entity-resolver');

    const candidates = await this.merger.findCandidates({
      tenantId: entity.tenantId,
      entityId: entity.id,
      threshold: this.cfg.knowledgeCore.entityMergeThreshold,
    });
    if (candidates.length === 0) {
      this.logger.debug({ entityId }, 'entity-resolver: кандидатов нет');
      return;
    }

    // Контекст блоков «этой» сущности — общий, не зависит от candidate.
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
      if (verdict.verdict === 'distinct') continue;
      // verdict='merge'
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

  /**
   * Атомарный merge entity → target. Все защиты внутри транзакции, чтобы
   * параллельный resolver-job для той же пары не разрушил состояние.
   */
  private async applyMerge(args: {
    entity: Entity;
    targetId: string;
    explanation: string;
  }): Promise<void> {
    const { entity, targetId } = args;
    if (targetId === entity.id) {
      throw new Error(
        `entity-resolver: targetId == entityId (${entity.id}) — abort`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Re-load под транзакцией.
      const fresh = await tx.entity.findUnique({ where: { id: entity.id } });
      if (!fresh) throw new Error(`entity ${entity.id} not found in tx`);
      if (fresh.mergedIntoId !== null) {
        throw new Error(
          `entity ${entity.id} уже merged_into=${fresh.mergedIntoId} — abort`,
        );
      }
      const target = await tx.entity.findUnique({ where: { id: targetId } });
      if (!target) {
        throw new Error(`target ${targetId} не найден — abort`);
      }
      if (target.mergedIntoId !== null) {
        throw new Error(
          `target ${targetId} сам merged_into=${target.mergedIntoId} — abort (race)`,
        );
      }
      if (target.tenantId !== fresh.tenantId) {
        throw new Error(
          `target.tenantId=${target.tenantId} != entity.tenantId=${fresh.tenantId} — abort`,
        );
      }
      if (target.type !== fresh.type) {
        throw new Error(
          `target.type=${target.type} != entity.type=${fresh.type} — abort`,
        );
      }

      // 1. Помечаем entity как merged_into.
      await tx.entity.update({
        where: { id: fresh.id },
        data: { mergedIntoId: targetId },
      });

      // 2. Обновляем target: mentionsCount, aliases (union).
      const newAliases = Array.from(
        new Set([...target.aliases, fresh.canonicalName, ...fresh.aliases]),
      ).filter((a) => a !== target.canonicalName);
      await tx.entity.update({
        where: { id: targetId },
        data: {
          mentionsCount: { increment: fresh.mentionsCount },
          aliases: newAliases,
        },
      });

      // 3. Переносим IdeaBlockEntity'и: entityId=fresh.id → targetId.
      //    Composite PK (blockId, entityId) может конфликтовать —
      //    идём по одному с try/skip P2002 (если в block уже есть mention
      //    target'а, удаляем mention'а entity).
      const mentions = await tx.ideaBlockEntity.findMany({
        where: { entityId: fresh.id },
      });
      for (const m of mentions) {
        try {
          await tx.ideaBlockEntity.update({
            where: {
              blockId_entityId: { blockId: m.blockId, entityId: fresh.id },
            },
            data: { entityId: targetId },
          });
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
          ) {
            await tx.ideaBlockEntity.delete({
              where: {
                blockId_entityId: { blockId: m.blockId, entityId: fresh.id },
              },
            });
            continue;
          }
          throw err;
        }
      }
    });

    this.logger.log(
      { entityId: entity.id, targetId, explanation: args.explanation },
      'entity-resolver: merged',
    );
  }

  private async onJobFailed(
    job: Job<EntityResolverJobData> | null,
    err: Error,
  ): Promise<void> {
    if (!job) return;
    if (job.attemptsMade < (job.opts.attempts ?? 5)) return;
    this.logger.error(
      { entityId: job.data.entityId, attempts: job.attemptsMade, err: err.message },
      'entity-resolver: финальный fail после всех ретраев',
    );
  }
}
