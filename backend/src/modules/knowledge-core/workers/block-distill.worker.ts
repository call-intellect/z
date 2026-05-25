import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { type IdeaBlock, Prisma } from '@prisma/client';
import { type Job, Worker } from 'bullmq';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';
import {
  type BlockDistillJobData,
  CORE_QUEUE_NAMES,
} from '../../core-queue/queues';
import { WorkerOrgGate } from '../../core-queue/worker-org-gate';
import { BlockMergeService } from '../services/block-merge.service';
import { FactSupersedeService } from '../services/fact-supersede.service';
import type { IdeaBlockUpdatedEvent } from '../services/projection-rebuilder.service';

/**
 * Block-distill worker (`core.block-distill` consumer).
 *
 * Шаги на job `{ blockId }`:
 *   1. findUnique IdeaBlock с evidence/entities. Если null → skip.
 *   2. Idempotency: status !== 'draft' → skip (уже обработан).
 *   3. KNN среди canonical того же tenant'а (cosine, threshold).
 *   4. Если кандидатов нет → mark canonical + enqueueBlockLinker.
 *   5. Иначе → judgeMerge:
 *      - distinct → as (4).
 *      - merge → транзакция:
 *          - block.status='merged_into', mergedIntoId=canonicalId.
 *          - перенос evidence на canonical (updateMany).
 *          - перенос entity-mention'ов на canonical (skip ON CONFLICT).
 *          - canonical: evidenceCount += block.evidenceCount, weighted-avg
 *            confidence, tags union.
 *      - после транзакции — enqueueBlockLinker(canonicalId).
 *
 * Concurrency=2: KNN-запрос и LLM-арбитр оба могут быть медленными.
 */
@Injectable()
export class BlockDistillWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BlockDistillWorker.name);
  private worker: Worker<BlockDistillJobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BlockMergeService) private readonly merger: BlockMergeService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Inject(WorkerOrgGate) private readonly gate: WorkerOrgGate,
    // KC-Temporal W1.2 — Optional, потому что воркер также крутится в
    // окружениях, где KnowledgeCoreModule пока не подключён (e2e/test).
    @Optional()
    @Inject(FactSupersedeService)
    private readonly factSupersede?: FactSupersedeService,
    // KC-Temporal W3.5 — Optional EventEmitter2 для emit'а
    // `idea_block.updated` (подписан ProjectionRebuilderService).
    // Optional, чтобы worker'у не было обязательным наличие
    // EventEmitterModule в DI-контексте (унит-тесты воркера).
    @Optional()
    @Inject(EventEmitter2)
    private readonly eventEmitter?: EventEmitter2,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<BlockDistillJobData>(
      CORE_QUEUE_NAMES.BLOCK_DISTILL,
      async (job) => this.process(job),
      {
        connection: this.redis.client,
        concurrency: 2,
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
      `BlockDistillWorker запущен (${CORE_QUEUE_NAMES.BLOCK_DISTILL})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  // ─────────────────────────── core ────────────────────────────────────────

  private async process(job: Job<BlockDistillJobData>): Promise<void> {
    const { blockId } = job.data;
    const block = await this.prisma.ideaBlock.findUnique({
      where: { id: blockId },
      include: { evidence: true, entities: true },
    });
    if (!block) {
      this.logger.warn({ blockId }, 'block-distill: IdeaBlock не найден — skip');
      return;
    }
    if (block.status !== 'draft') {
      this.logger.debug(
        { blockId, status: block.status },
        'block-distill: статус не draft — skip (уже обработан)',
      );
      return;
    }

    // Org-Admin Фаза 7: проверка тумблера.
    await this.gate.checkOrThrow(block.tenantId, 'block-distill');

    const candidates = await this.merger.knnCandidates({
      tenantId: block.tenantId,
      blockId: block.id,
      topK: this.cfg.knowledgeCore.distillKnnTopK,
      threshold: this.cfg.knowledgeCore.distillMergeThreshold,
    });

    if (candidates.length === 0) {
      await this.markCanonical(block);
      return;
    }

    const verdict = await this.merger.judgeMerge({
      tenantId: block.tenantId,
      blockId: block.id,
      newBlock: block,
      candidates: candidates.map((c) => c.candidate),
    });

    if (verdict.verdict === 'distinct') {
      await this.markCanonical(block);
      return;
    }

    await this.mergeInto({
      block,
      canonicalId: verdict.canonicalId,
      explanation: verdict.explanation,
    });
  }

  // ─────────────────────────── transitions ─────────────────────────────────

  private async markCanonical(block: IdeaBlock): Promise<void> {
    await this.prisma.ideaBlock.update({
      where: { id: block.id },
      data: { status: 'canonical' },
    });
    await this.coreQueue.enqueueBlockLinker(block.id).catch((err) => {
      this.logger.warn(
        { blockId: block.id, err: err instanceof Error ? err.message : String(err) },
        'block-distill: enqueueBlockLinker упал — линковка отложена',
      );
    });
    this.logger.log({ blockId: block.id }, 'block-distill: canonical');

    // KC-Temporal W3.5 — best-effort emit для ProjectionRebuilderService.
    // Если EventEmitter2 не задан (тестовое окружение) — просто пропускаем.
    this.emitIdeaBlockUpdated({
      tenantId: block.tenantId,
      blockId: block.id,
      changeKind: 'updated',
      emittedAt: Date.now(),
    });

    // KC-Temporal W1.2 — fact-supersede best-effort. Запускается только
    // если включены оба флага (BITEMPORAL_ENABLED + BITEMPORAL_SUPERSEDE_ENABLED).
    // Все ошибки сервиса проглатываются, чтобы не ронять воркер distill.
    if (
      this.factSupersede &&
      this.cfg.bitemporal.enabled &&
      this.cfg.bitemporal.supersedeEnabled
    ) {
      try {
        await this.factSupersede.processNewBlock(block.id);
      } catch (err) {
        this.logger.warn(
          {
            blockId: block.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'block-distill: FactSupersedeService упал — продолжаем (best-effort)',
        );
      }
    }
  }

  private async mergeInto(args: {
    block: IdeaBlock;
    canonicalId: string;
    explanation: string;
  }): Promise<void> {
    const { block, canonicalId } = args;
    if (canonicalId === block.id) {
      this.logger.warn(
        { blockId: block.id },
        'block-distill: canonicalId == blockId — некорректно, fallback canonical',
      );
      await this.markCanonical(block);
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      const canonical = await tx.ideaBlock.findUnique({
        where: { id: canonicalId },
      });
      if (!canonical) {
        throw new Error(
          `block-distill: canonical ${canonicalId} не найден — abort merge`,
        );
      }
      if (canonical.status !== 'canonical') {
        // Канонический блок мог быть сам merged_into между KNN и сейчас.
        // Безопаснее всего — fallback в canonical: цепочки merge не
        // выстраиваем, чтобы не запутаться.
        throw new Error(
          `block-distill: target ${canonicalId} имеет статус ${canonical.status}, не canonical`,
        );
      }

      // 1. Помечаем текущий блок как merged_into.
      await tx.ideaBlock.update({
        where: { id: block.id },
        data: {
          status: 'merged_into',
          mergedIntoId: canonicalId,
        },
      });

      // 2. Переносим все evidence на canonical.
      await tx.ideaBlockEvidence.updateMany({
        where: { blockId: block.id },
        data: { blockId: canonicalId },
      });

      // 3. Переносим entity-mention'ы. Composite PK (blockId, entityId) может
      //    конфликтовать, если canonical уже линкован к той же entity —
      //    делаем по одному с try/skip P2002.
      const mentions = await tx.ideaBlockEntity.findMany({
        where: { blockId: block.id },
      });
      for (const m of mentions) {
        try {
          await tx.ideaBlockEntity.update({
            where: { blockId_entityId: { blockId: block.id, entityId: m.entityId } },
            data: { blockId: canonicalId },
          });
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
          ) {
            // Дубль — удаляем mention со старого блока, оставляем canonical-вариант.
            await tx.ideaBlockEntity.delete({
              where: { blockId_entityId: { blockId: block.id, entityId: m.entityId } },
            });
            continue;
          }
          throw err;
        }
      }

      // 4. Обновляем canonical: evidenceCount, confidence (weighted average),
      //    tags (union), updatedAt.
      const newEvidenceCount =
        canonical.evidenceCount + Math.max(1, block.evidenceCount);
      const canonicalConf = new Prisma.Decimal(canonical.confidence);
      const blockConf = new Prisma.Decimal(block.confidence);
      const totalWeighted = canonicalConf
        .mul(canonical.evidenceCount)
        .plus(blockConf.mul(Math.max(1, block.evidenceCount)));
      const avgConf = totalWeighted.div(newEvidenceCount);
      const mergedTags = Array.from(
        new Set([...canonical.tags, ...block.tags]),
      );

      await tx.ideaBlock.update({
        where: { id: canonicalId },
        data: {
          evidenceCount: newEvidenceCount,
          confidence: new Prisma.Decimal(avgConf.toFixed(3)),
          tags: mergedTags,
        },
      });
    });

    // 5. Линкер для canonical — связи могли поменяться.
    await this.coreQueue.enqueueBlockLinker(canonicalId).catch((err) => {
      this.logger.warn(
        {
          canonicalId,
          err: err instanceof Error ? err.message : String(err),
        },
        'block-distill: enqueueBlockLinker(canonical) упал — пересчёт отложен',
      );
    });

    this.logger.log(
      { blockId: block.id, canonicalId, explanation: args.explanation },
      'block-distill: merged_into',
    );

    // KC-Temporal W3.5 — emit'им по canonicalId (это «живой» блок,
    // через который пересобираются Decision/Insight/...; merged-блок
    // больше не используется как источник). changeKind='merged' даёт
    // ProjectionRebuilderService возможность отличить merge-trigger
    // от обычного update'а (для метрик / алертов).
    this.emitIdeaBlockUpdated({
      tenantId: block.tenantId,
      blockId: canonicalId,
      changeKind: 'merged',
      emittedAt: Date.now(),
    });
  }

  /**
   * KC-Temporal W3.5 — best-effort emit `idea_block.updated`. Все ошибки
   * проглатываем (warn-лог), чтобы не валить distill из-за проблем в
   * подписчиках.
   */
  private emitIdeaBlockUpdated(event: IdeaBlockUpdatedEvent): void {
    if (!this.eventEmitter) return;
    try {
      this.eventEmitter.emit('idea_block.updated', event);
    } catch (err) {
      this.logger.warn(
        {
          blockId: event.blockId,
          err: err instanceof Error ? err.message : String(err),
        },
        'block-distill: emit idea_block.updated упал — пропускаем',
      );
    }
  }

  private async onJobFailed(
    job: Job<BlockDistillJobData> | null,
    err: Error,
  ): Promise<void> {
    if (!job) return;
    if (job.attemptsMade < (job.opts.attempts ?? 5)) return;
    this.logger.error(
      { blockId: job.data.blockId, attempts: job.attemptsMade, err: err.message },
      'block-distill: финальный fail после всех ретраев',
    );
  }
}
