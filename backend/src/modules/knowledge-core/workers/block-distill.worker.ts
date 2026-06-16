import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { type IdeaBlock, Prisma, type SignalType } from '@prisma/client';
import { type Job, Worker } from 'bullmq';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';
import { type BlockDistillJobData, CORE_QUEUE_NAMES } from '../../core-queue/queues';
import { WorkerOrgGate } from '../../core-queue/worker-org-gate';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { BlockMergeService } from '../services/block-merge.service';
import { FactSupersedeService } from '../services/fact-supersede.service';
import type { IdeaBlockUpdatedEvent } from '../services/projection-rebuilder.service';
import { RouterService } from '../services/router.service';

@Injectable()
export class BlockDistillWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BlockDistillWorker.name);
  private worker: Worker<BlockDistillJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BlockMergeService) private readonly merger: BlockMergeService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Inject(WorkerOrgGate) private readonly gate: WorkerOrgGate,
    @Inject(RouterService) private readonly router: RouterService,
    @Optional()
    @Inject(FactSupersedeService)
    private readonly factSupersede?: FactSupersedeService,
    @Optional()
    @Inject(EventEmitter2)
    private readonly eventEmitter?: EventEmitter2,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<BlockDistillJobData>(
      CORE_QUEUE_NAMES.BLOCK_DISTILL,
      async (job) =>
        this.pipe.job(SystemLogPipeline.KNOWLEDGE_GRAPH, 'kc.block-distill', job, () =>
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
    this.logger.debug(`BlockDistillWorker запущен (${CORE_QUEUE_NAMES.BLOCK_DISTILL})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

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

    const chosenCanonical = candidates.find(
      (c) => c.candidate.id === verdict.canonicalId,
    )?.candidate;
    const newIsTranscript = (block.primarySource ?? 'transcript') === 'transcript';
    const canonicalIsReport = chosenCanonical?.primarySource === 'report';
    if (chosenCanonical && newIsTranscript && canonicalIsReport) {
      await this.swapDirection({
        transcriptBlock: block,
        reportCanonicalId: verdict.canonicalId,
        explanation: verdict.explanation,
      });
      return;
    }

    await this.mergeInto({
      block,
      canonicalId: verdict.canonicalId,
      explanation: verdict.explanation,
    });
  }

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
    this.logger.debug({ blockId: block.id }, 'block-distill: canonical');

    await this.router
      .dispatch({
        id: block.id,
        tenantId: block.tenantId,
        signalType: block.signalType,
      })
      .catch((err) => {
        this.logger.warn(
          {
            blockId: block.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'block-distill: router.dispatch(canonical) упал — проекции отложены',
        );
      });

    this.emitIdeaBlockUpdated({
      tenantId: block.tenantId,
      blockId: block.id,
      changeKind: 'updated',
      emittedAt: Date.now(),
    });

    if (this.factSupersede && this.cfg.bitemporal.enabled && this.cfg.bitemporal.supersedeEnabled) {
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

    let canonicalSignalType: SignalType | null = null;

    await this.prisma.$transaction(async (tx) => {
      const canonical = await tx.ideaBlock.findUnique({
        where: { id: canonicalId },
      });
      if (!canonical) {
        throw new Error(`block-distill: canonical ${canonicalId} не найден — abort merge`);
      }
      canonicalSignalType = canonical.signalType;
      if (canonical.status !== 'canonical') {
        throw new Error(
          `block-distill: target ${canonicalId} имеет статус ${canonical.status}, не canonical`,
        );
      }

      await tx.ideaBlock.update({
        where: { id: block.id },
        data: {
          status: 'merged_into',
          mergedIntoId: canonicalId,
        },
      });

      await tx.ideaBlockEvidence.updateMany({
        where: { blockId: block.id },
        data: { blockId: canonicalId },
      });

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
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            await tx.ideaBlockEntity.delete({
              where: { blockId_entityId: { blockId: block.id, entityId: m.entityId } },
            });
            continue;
          }
          throw err;
        }
      }

      const newEvidenceCount = canonical.evidenceCount + Math.max(1, block.evidenceCount);
      const canonicalConf = new Prisma.Decimal(canonical.confidence);
      const blockConf = new Prisma.Decimal(block.confidence);
      const totalWeighted = canonicalConf
        .mul(canonical.evidenceCount)
        .plus(blockConf.mul(Math.max(1, block.evidenceCount)));
      const avgConf = totalWeighted.div(newEvidenceCount);
      const mergedTags = Array.from(new Set([...canonical.tags, ...block.tags]));

      await tx.ideaBlock.update({
        where: { id: canonicalId },
        data: {
          evidenceCount: newEvidenceCount,
          confidence: new Prisma.Decimal(avgConf.toFixed(3)),
          tags: mergedTags,
        },
      });
    });

    await this.coreQueue.enqueueBlockLinker(canonicalId).catch((err) => {
      this.logger.warn(
        {
          canonicalId,
          err: err instanceof Error ? err.message : String(err),
        },
        'block-distill: enqueueBlockLinker(canonical) упал — пересчёт отложен',
      );
    });

    this.logger.debug(
      { blockId: block.id, canonicalId, explanation: args.explanation },
      'block-distill: merged_into',
    );

    if (canonicalSignalType !== null) {
      await this.router
        .dispatch({
          id: canonicalId,
          tenantId: block.tenantId,
          signalType: canonicalSignalType,
        })
        .catch((err) => {
          this.logger.warn(
            {
              canonicalId,
              err: err instanceof Error ? err.message : String(err),
            },
            'block-distill: router.dispatch(merged canonical) упал — проекции отложены',
          );
        });
    }

    this.emitIdeaBlockUpdated({
      tenantId: block.tenantId,
      blockId: canonicalId,
      changeKind: 'merged',
      emittedAt: Date.now(),
    });
  }

  private async swapDirection(args: {
    transcriptBlock: IdeaBlock;
    reportCanonicalId: string;
    explanation: string;
  }): Promise<void> {
    const { transcriptBlock, reportCanonicalId } = args;
    if (reportCanonicalId === transcriptBlock.id) {
      this.logger.warn(
        { blockId: transcriptBlock.id },
        'block-distill: swap reportCanonicalId == blockId — fallback canonical',
      );
      await this.markCanonical(transcriptBlock);
      return;
    }

    let canonicalSignalType: SignalType | null = null;

    await this.prisma.$transaction(async (tx) => {
      const reportCanonical = await tx.ideaBlock.findUnique({
        where: { id: reportCanonicalId },
      });
      if (!reportCanonical) {
        throw new Error(
          `block-distill: report-canonical ${reportCanonicalId} не найден — abort swap`,
        );
      }
      if (reportCanonical.status !== 'canonical') {
        throw new Error(
          `block-distill: swap target ${reportCanonicalId} имеет статус ${reportCanonical.status}, не canonical`,
        );
      }

      canonicalSignalType = transcriptBlock.signalType;

      await tx.ideaBlock.update({
        where: { id: reportCanonicalId },
        data: {
          status: 'merged_into',
          mergedIntoId: transcriptBlock.id,
        },
      });

      await tx.ideaBlockEvidence.updateMany({
        where: { blockId: reportCanonicalId },
        data: { blockId: transcriptBlock.id },
      });

      const mentions = await tx.ideaBlockEntity.findMany({
        where: { blockId: reportCanonicalId },
      });
      for (const m of mentions) {
        try {
          await tx.ideaBlockEntity.update({
            where: {
              blockId_entityId: {
                blockId: reportCanonicalId,
                entityId: m.entityId,
              },
            },
            data: { blockId: transcriptBlock.id },
          });
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            await tx.ideaBlockEntity.delete({
              where: {
                blockId_entityId: {
                  blockId: reportCanonicalId,
                  entityId: m.entityId,
                },
              },
            });
            continue;
          }
          throw err;
        }
      }

      const newEvidenceCount =
        transcriptBlock.evidenceCount + Math.max(1, reportCanonical.evidenceCount);
      const transcriptConf = new Prisma.Decimal(transcriptBlock.confidence);
      const reportConf = new Prisma.Decimal(reportCanonical.confidence);
      const maxConf = transcriptConf.greaterThanOrEqualTo(reportConf) ? transcriptConf : reportConf;
      const mergedTags = Array.from(new Set([...transcriptBlock.tags, ...reportCanonical.tags]));

      await tx.ideaBlock.update({
        where: { id: transcriptBlock.id },
        data: {
          status: 'canonical',
          mergedIntoId: null,
          evidenceCount: newEvidenceCount,
          confidence: new Prisma.Decimal(maxConf.toFixed(3)),
          tags: mergedTags,
        },
      });
    });

    await this.coreQueue.enqueueBlockLinker(transcriptBlock.id).catch((err) => {
      this.logger.warn(
        {
          blockId: transcriptBlock.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'block-distill: enqueueBlockLinker(swap canonical) упал — пересчёт отложен',
      );
    });

    this.logger.debug(
      {
        transcriptBlockId: transcriptBlock.id,
        reportCanonicalId,
        explanation: args.explanation,
      },
      'block-distill: swapDirection — транскрипт стал canonical, report → merged_into',
    );

    if (canonicalSignalType !== null) {
      await this.router
        .dispatch({
          id: transcriptBlock.id,
          tenantId: transcriptBlock.tenantId,
          signalType: canonicalSignalType,
        })
        .catch((err) => {
          this.logger.warn(
            {
              blockId: transcriptBlock.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'block-distill: router.dispatch(swap canonical) упал — проекции отложены',
          );
        });
    }

    this.emitIdeaBlockUpdated({
      tenantId: transcriptBlock.tenantId,
      blockId: transcriptBlock.id,
      changeKind: 'merged',
      emittedAt: Date.now(),
    });
  }

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

  private async onJobFailed(job: Job<BlockDistillJobData> | null, err: Error): Promise<void> {
    if (!job) return;
    if (job.attemptsMade < (job.opts.attempts ?? 5)) return;
    this.logger.error(
      { blockId: job.data.blockId, attempts: job.attemptsMade, err: err.message },
      'block-distill: финальный fail после всех ретраев',
    );
  }
}
