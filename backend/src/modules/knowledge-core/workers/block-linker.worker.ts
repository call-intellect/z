import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type Job, Worker } from 'bullmq';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import {
  type BlockLinkerJobData,
  CORE_QUEUE_NAMES,
} from '../../core-queue/queues';
import { BlockLinkService } from '../services/block-link.service';

/**
 * Block-linker worker (`core.block-linker` consumer, Фаза 3).
 *
 * Триггер: `enqueueBlockLinker(blockId)` в `BlockDistillWorker` после
 * mark canonical / mergeInto. На Фазе 2 jobs накапливались — теперь
 * разгребаются в этом воркере.
 *
 * Шаги:
 *   1. findUnique IdeaBlock(blockId). Если null или status !== 'canonical' → skip.
 *   2. Гейт: count(canonical в Org) >= LINKER_MIN_BLOCKS. Иначе skip + лог.
 *   3. KNN top-K кандидатов (BlockLinkService.findLinkCandidates).
 *   4. По каждому кандидату — LLM-арбитр (последовательно, чтобы не словить
 *      rate limit). Если verdict valid и confidence >= LINK_MIN_CONFIDENCE →
 *      upsert IdeaBlockLink.
 *   5. Любая ошибка LLM → продолжаем со следующим кандидатом, не валим job.
 *
 * Concurrency=2 — по аналогии с distill.
 */
@Injectable()
export class BlockLinkerWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BlockLinkerWorker.name);
  private worker: Worker<BlockLinkerJobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BlockLinkService) private readonly linker: BlockLinkService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<BlockLinkerJobData>(
      CORE_QUEUE_NAMES.BLOCK_LINKER,
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
      `BlockLinkerWorker запущен (${CORE_QUEUE_NAMES.BLOCK_LINKER})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  // ─────────────────────────── core ────────────────────────────────────────

  private async process(job: Job<BlockLinkerJobData>): Promise<void> {
    const { blockId } = job.data;
    const block = await this.prisma.ideaBlock.findUnique({
      where: { id: blockId },
    });
    if (!block) {
      this.logger.warn({ blockId }, 'block-linker: IdeaBlock не найден — skip');
      return;
    }
    if (block.status !== 'canonical') {
      this.logger.debug(
        { blockId, status: block.status },
        'block-linker: статус не canonical — skip',
      );
      return;
    }

    // Гейт по объёму: меньше LINKER_MIN_BLOCKS canonical в Org — связывать нечего.
    const minBlocks = this.cfg.knowledgeCore.linkerMinBlocks;
    const canonicalCount = await this.prisma.ideaBlock.count({
      where: { tenantId: block.tenantId, status: 'canonical' },
    });
    if (canonicalCount < minBlocks) {
      this.logger.log(
        { blockId, tenantId: block.tenantId, canonicalCount, threshold: minBlocks },
        'block-linker: канонических блоков меньше порога — skip',
      );
      return;
    }

    const topK = this.cfg.knowledgeCore.linkKnnTopK;
    const candidates = await this.linker.findLinkCandidates({
      tenantId: block.tenantId,
      blockId: block.id,
      topK,
    });

    const minConfidence = this.cfg.knowledgeCore.linkMinConfidence;
    let createdCount = 0;
    for (const { candidate } of candidates) {
      try {
        const verdict = await this.linker.judgeLink({
          tenantId: block.tenantId,
          fromBlock: block,
          toBlock: candidate,
        });
        if (verdict.relationType === null) continue;
        if (verdict.confidence < minConfidence) continue;

        const confidenceDecimal = new Prisma.Decimal(
          verdict.confidence.toFixed(3),
        );
        await this.prisma.ideaBlockLink.upsert({
          where: {
            fromBlockId_toBlockId_relationType: {
              fromBlockId: block.id,
              toBlockId: candidate.id,
              relationType: verdict.relationType,
            },
          },
          update: {
            confidence: confidenceDecimal,
            explanation: verdict.explanation,
            status: 'active',
          },
          create: {
            tenantId: block.tenantId,
            fromBlockId: block.id,
            toBlockId: candidate.id,
            relationType: verdict.relationType,
            confidence: confidenceDecimal,
            explanation: verdict.explanation,
            createdBy: 'linker',
            status: 'active',
          },
        });
        createdCount += 1;
      } catch (err) {
        this.logger.warn(
          {
            blockId: block.id,
            candidateId: candidate.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'block-linker: ошибка LLM/upsert на кандидате — продолжаю',
        );
      }
    }

    this.logger.log(
      {
        blockId: block.id,
        tenantId: block.tenantId,
        candidates: candidates.length,
        created: createdCount,
      },
      'block-linker: проход завершён',
    );
  }

  private async onJobFailed(
    job: Job<BlockLinkerJobData> | null,
    err: Error,
  ): Promise<void> {
    if (!job) return;
    if (job.attemptsMade < (job.opts.attempts ?? 5)) return;
    this.logger.error(
      { blockId: job.data.blockId, attempts: job.attemptsMade, err: err.message },
      'block-linker: финальный fail после всех ретраев',
    );
  }
}
