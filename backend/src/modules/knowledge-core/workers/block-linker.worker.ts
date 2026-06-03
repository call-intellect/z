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
import { WorkerOrgGate } from '../../core-queue/worker-org-gate';
import { ConflictService } from '../../curation/services/conflict.service';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { BlockLinkService } from '../services/block-link.service';
import { TemporalConflictService } from '../services/temporal-conflict.service';

/**
 * SBA α-4 — порог confidence, выше которого `relationType='contradicts'`
 * link автоматически эскалируется в `ConflictService.report(...)`. Ниже —
 * это «слабый» сигнал противоречия (остаётся только как link).
 */
const CONFLICT_AUTO_ESCALATE_CONFIDENCE = 0.85;

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

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BlockLinkService) private readonly linker: BlockLinkService,
    @Inject(WorkerOrgGate) private readonly gate: WorkerOrgGate,
    @Inject(ConflictService) private readonly conflicts: ConflictService,
    @Inject(TemporalConflictService)
    private readonly temporalConflict: TemporalConflictService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<BlockLinkerJobData>(
      CORE_QUEUE_NAMES.BLOCK_LINKER,
      async (job) =>
        this.pipe.job(SystemLogPipeline.KNOWLEDGE_GRAPH, 'kc.block-linker', job, () =>
          this.process(job),
        ),
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

    // Org-Admin Фаза 7: проверка тумблера.
    await this.gate.checkOrThrow(block.tenantId, 'block-linker');

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
        // Agents v2 Фаза A1 — bi-temporal. validFrom/validUntil из LLM-hint
        // (если LLM смог распарсить временной указатель из блоков). Если
        // hint'ов нет — null; TemporalConflictService потом проставит
        // validFrom = NOW() если возникнет конфликт.
        const validFrom = parseIsoHint(verdict.validFromHint);
        const validUntil = parseIsoHint(verdict.validUntilHint);

        const upserted = await this.prisma.ideaBlockLink.upsert({
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
            // Обновляем temporal-поля только если LLM явно их вернул
            // (не затираем существующие значения null'ом).
            ...(validFrom !== null ? { validFrom } : {}),
            ...(validUntil !== null ? { validUntil } : {}),
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
            validFrom,
            validUntil,
          },
        });
        createdCount += 1;

        // Agents v2 Фаза A1 — best-effort: закрыть противоречащие existing
        // open-links того же (from,to). Не валит job на ошибке.
        try {
          await this.temporalConflict.onNewBlockLink(upserted);
        } catch (err) {
          this.logger.warn(
            {
              linkId: upserted.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'block-linker: TemporalConflictService.onNewBlockLink упал — продолжаю',
          );
        }

        // SBA α-4 — эскалация в Слой 4: высокоуверенный `contradicts` →
        // `ConflictItem`. Best-effort: ошибка не валит link-job.
        if (
          verdict.relationType === 'contradicts' &&
          verdict.confidence >= CONFLICT_AUTO_ESCALATE_CONFIDENCE
        ) {
          try {
            await this.conflicts.report({
              tenantId: block.tenantId,
              resourceType: 'idea_block',
              existingId: candidate.id,
              newId: block.id,
              evidence: {
                blockIds: [block.id, candidate.id],
                relationType: verdict.relationType,
                confidence: verdict.confidence,
                explanation: verdict.explanation,
              },
              relationType: verdict.relationType,
              detectedBy: 'block-linker',
            });
          } catch (err) {
            this.logger.warn(
              {
                blockId: block.id,
                candidateId: candidate.id,
                err: err instanceof Error ? err.message : String(err),
              },
              'block-linker: ошибка ConflictService.report — продолжаю',
            );
          }
        }
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

/**
 * Agents v2 Фаза A1 — узкий парсер ISO-hint'ов от LLM. Принимает строку
 * вида `YYYY-MM-DD` / `YYYY-MM` / `YYYY` и возвращает Date (полночь UTC).
 * При любой проблеме (null, undefined, мусор) — возвращает null, чтобы
 * не валить upsert.
 */
function parseIsoHint(hint: string | null | undefined): Date | null {
  if (!hint) return null;
  const trimmed = hint.trim();
  if (trimmed.length === 0) return null;
  // Полная ISO-дата.
  let iso: string;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    iso = trimmed.length === 10 ? `${trimmed}T00:00:00.000Z` : trimmed;
  } else if (/^\d{4}-\d{2}$/.test(trimmed)) {
    iso = `${trimmed}-01T00:00:00.000Z`;
  } else if (/^\d{4}$/.test(trimmed)) {
    iso = `${trimmed}-01-01T00:00:00.000Z`;
  } else {
    return null;
  }
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}
