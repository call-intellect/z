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
import { type BlockLinkerJobData, CORE_QUEUE_NAMES } from '../../core-queue/queues';
import { WorkerOrgGate } from '../../core-queue/worker-org-gate';
import { ConflictService } from '../../curation/services/conflict.service';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { BlockLinkService } from '../services/block-link.service';
import { TemporalConflictService } from '../services/temporal-conflict.service';

const CONFLICT_AUTO_ESCALATE_CONFIDENCE = 0.85;

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
        this.logger.error(`onJobFailed: ${e instanceof Error ? e.message : String(e)}`);
      });
    });
    this.logger.debug(`BlockLinkerWorker запущен (${CORE_QUEUE_NAMES.BLOCK_LINKER})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

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

    await this.gate.checkOrThrow(block.tenantId, 'block-linker');

    const minBlocks = this.cfg.knowledgeCore.linkerMinBlocks;
    const canonicalCount = await this.prisma.ideaBlock.count({
      where: { tenantId: block.tenantId, status: 'canonical' },
    });
    if (canonicalCount < minBlocks) {
      this.logger.debug(
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

        const confidenceDecimal = new Prisma.Decimal(verdict.confidence.toFixed(3));
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

    this.logger.debug(
      {
        blockId: block.id,
        tenantId: block.tenantId,
        candidates: candidates.length,
        created: createdCount,
      },
      'block-linker: проход завершён',
    );
  }

  private async onJobFailed(job: Job<BlockLinkerJobData> | null, err: Error): Promise<void> {
    if (!job) return;
    if (job.attemptsMade < (job.opts.attempts ?? 5)) return;
    this.logger.error(
      { blockId: job.data.blockId, attempts: job.attemptsMade, err: err.message },
      'block-linker: финальный fail после всех ретраев',
    );
  }
}

function parseIsoHint(hint: string | null | undefined): Date | null {
  if (!hint) return null;
  const trimmed = hint.trim();
  if (trimmed.length === 0) return null;
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
