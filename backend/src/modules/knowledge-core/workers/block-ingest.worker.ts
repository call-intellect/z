import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type EntityType, Prisma, type RawEvent } from '@prisma/client';
import { type Job, Worker } from 'bullmq';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';
import {
  CORE_QUEUE_NAMES,
  type RawEventJobData,
} from '../../core-queue/queues';
import { WorkerOrgGate } from '../../core-queue/worker-org-gate';
import { S3Service } from '../../recordings/s3.service';
import { ENTITY_TYPE_VALUES } from '../prompts/block-ingest.prompt';
import {
  BlockExtractionService,
  type ExtractedBlock,
  type ExtractedEntityMention,
} from '../services/block-extraction.service';
import { KnowledgeEmbeddingService } from '../services/embedding.service';
import { EntityResolutionService } from '../services/entity-resolution.service';
import { SegmentBuilderService } from '../services/segment-builder.service';

/**
 * Block-ingest worker (`core.raw-events` consumer).
 *
 * Шаги на job `{ rawEventId }`:
 *   1. findUnique RawEvent. Если null → skip.
 *   2. Idempotency: processingStatus !== 'received' → skip.
 *   3. Загружаем payload (inline или S3).
 *   4. Строим сегменты (SegmentBuilder).
 *   5. Извлекаем ExtractedBlock'и (BlockExtraction).
 *   6. Эмбеддим блоки (один батч на все).
 *   7. На каждый блок — Prisma-транзакция:
 *      - create IdeaBlock + executeRaw embedding.
 *      - create IdeaBlockEvidence.
 *      - upsert Entity'ев + create IdeaBlockEntity (skip P2002).
 *   8. Вне транзакции — enqueueBlockDistill(blockId).
 *   9. RawEvent → processingStatus='ingested', processedAt=now.
 *  На ошибку — processingStatus='failed', processingError=msg, BullMQ retry.
 *
 * Concurrency=2: LLM-вызовы — наиболее тяжёлая часть, упираемся в провайдера.
 */
@Injectable()
export class BlockIngestWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BlockIngestWorker.name);
  private worker: Worker<RawEventJobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(SegmentBuilderService)
    private readonly segments: SegmentBuilderService,
    @Inject(BlockExtractionService)
    private readonly extractor: BlockExtractionService,
    @Inject(KnowledgeEmbeddingService)
    private readonly embeddings: KnowledgeEmbeddingService,
    @Inject(EntityResolutionService)
    private readonly entities: EntityResolutionService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Inject(WorkerOrgGate) private readonly gate: WorkerOrgGate,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<RawEventJobData>(
      CORE_QUEUE_NAMES.RAW_EVENTS,
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
    this.logger.log(`BlockIngestWorker запущен (${CORE_QUEUE_NAMES.RAW_EVENTS})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  // ─────────────────────────── core ────────────────────────────────────────

  private async process(job: Job<RawEventJobData>): Promise<void> {
    const { rawEventId } = job.data;
    const event = await this.prisma.rawEvent.findUnique({
      where: { id: rawEventId },
    });
    if (!event) {
      this.logger.warn({ rawEventId }, 'block-ingest: RawEvent не найден — skip');
      return;
    }
    if (event.processingStatus !== 'received') {
      this.logger.debug(
        { rawEventId, status: event.processingStatus },
        'block-ingest: статус не received — skip (идемпотентность)',
      );
      return;
    }

    // Org-Admin Фаза 7: проверка тумблера. Если выключено — throw'нём,
    // BullMQ ретрайнет и в итоге пометит job failed; owner может включить
    // обратно и retry вручную.
    await this.gate.checkOrThrow(event.tenantId, 'block-ingest');

    try {
      const payload = await this.loadPayload(event);
      const segments = this.segments.buildSegments(payload);
      const meetingTitle = this.tryGetMeetingTitle(payload);
      const { blocks } = await this.extractor.extractBlocks({
        tenantId: event.tenantId,
        rawEventId: event.id,
        meetingTitle,
        segments,
      });
      this.logger.log(
        { rawEventId, segments: segments.length, blocks: blocks.length },
        'block-ingest: извлечение завершено',
      );

      const embeddings =
        blocks.length > 0 ? await this.embeddings.embedBlocks(blocks) : [];

      const blockIds: string[] = [];
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i] as ExtractedBlock;
        const vector = embeddings[i];
        const blockId = await this.persistBlock({
          event,
          block,
          embedding: vector ?? null,
        });
        if (blockId) blockIds.push(blockId);
      }

      await this.prisma.rawEvent.update({
        where: { id: rawEventId },
        data: {
          processingStatus: 'ingested',
          processedAt: new Date(),
          processingError: null,
        },
      });

      // enqueue в block-distill — после успешной фиксации БД, чтобы не
      // распилить блок до того, как все его evidence/entities записались.
      // Дебаунс 30s даёт окно «успеть прийти соседним блокам».
      for (const blockId of blockIds) {
        await this.coreQueue.enqueueBlockDistill(blockId).catch((err) => {
          this.logger.warn(
            { blockId, err: err instanceof Error ? err.message : String(err) },
            'block-ingest: enqueueBlockDistill упал — дистилляция произойдёт позже',
          );
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        { rawEventId, err: message },
        'block-ingest: ошибка обработки — RawEvent помечен failed, BullMQ ретрайнет',
      );
      await this.prisma.rawEvent
        .update({
          where: { id: rawEventId },
          data: {
            processingStatus: 'failed',
            processingError: message.slice(0, 4000),
          },
        })
        .catch(() => undefined);
      throw err;
    }
  }

  // ─────────────────────────── pieces ──────────────────────────────────────

  private async loadPayload(event: RawEvent): Promise<unknown> {
    if (event.payloadStorage === 's3') {
      if (!event.payloadS3Key) {
        throw new Error(
          `RawEvent ${event.id}: payloadStorage=s3, но payloadS3Key пустой`,
        );
      }
      return this.s3.getJson<unknown>(event.payloadS3Key);
    }
    return event.payload;
  }

  private tryGetMeetingTitle(payload: unknown): string | undefined {
    if (typeof payload !== 'object' || payload === null) return undefined;
    const t = (payload as { title?: unknown }).title;
    return typeof t === 'string' && t.length > 0 ? t : undefined;
  }

  /**
   * Один блок → IdeaBlock + Evidence + IdeaBlockEntity'и. Возвращает blockId
   * (или null, если блок не сохранился из-за непредвиденной ошибки — мы её
   * логируем, но не валим весь job).
   */
  private async persistBlock(args: {
    event: RawEvent;
    block: ExtractedBlock;
    embedding: number[] | null;
  }): Promise<string | null> {
    const { event, block, embedding } = args;
    try {
      const blockId = await this.prisma.$transaction(async (tx) => {
        const ideaBlock = await tx.ideaBlock.create({
          data: {
            tenantId: event.tenantId,
            name: block.name.slice(0, 200),
            criticalQuestion: block.criticalQuestion,
            trustedAnswer: block.trustedAnswer,
            tags: block.tags,
            signalType: block.signalType,
            confidence: new Prisma.Decimal(block.confidence.toFixed(3)),
            dataClass: event.dataClass,
            status: 'draft',
            evidenceCount: 1,
          },
        });
        if (embedding && embedding.length > 0) {
          await tx.$executeRawUnsafe(
            'UPDATE "IdeaBlock" SET embedding = $1::vector(1536) WHERE id = $2',
            this.toVectorLiteral(embedding),
            ideaBlock.id,
          );
        }
        await tx.ideaBlockEvidence.create({
          data: {
            blockId: ideaBlock.id,
            rawEventId: event.id,
            sourceType: event.sourceType,
            sourceTimestamp: event.occurredAt,
            quote: block.evidenceQuote,
            startMs: block.evidenceStartMs,
            endMs: block.evidenceEndMs,
          },
        });
        return ideaBlock.id;
      });

      // Сущности — вне транзакции IdeaBlock'а: findOrCreate на каждой entity
      // делает свой $executeRaw для embedding, что несовместимо с
      // interactive-tx без увеличения statement_timeout. Согласованность
      // здесь не критична: если ниже упадёт — block уже создан, его
      // entities создадутся при следующем upsert (mentionsCount правильно
      // увеличится).
      for (const mention of block.mentionedEntities) {
        await this.linkEntity({
          tenantId: event.tenantId,
          blockId,
          mention,
        }).catch((err) => {
          this.logger.warn(
            {
              blockId,
              entityName: mention.name,
              err: err instanceof Error ? err.message : String(err),
            },
            'block-ingest: сущность не привязалась — пропуск',
          );
        });
      }
      return blockId;
    } catch (err) {
      this.logger.error(
        {
          rawEventId: event.id,
          blockName: block.name,
          err: err instanceof Error ? err.message : String(err),
        },
        'block-ingest: persistBlock упал — блок пропущен',
      );
      return null;
    }
  }

  private async linkEntity(args: {
    tenantId: string;
    blockId: string;
    mention: ExtractedEntityMention;
  }): Promise<void> {
    if (!ENTITY_TYPE_VALUES.includes(args.mention.type)) {
      return;
    }
    const { entity } = await this.entities.findOrCreateEntity({
      tenantId: args.tenantId,
      type: args.mention.type as EntityType,
      name: args.mention.name,
      metadata: args.mention.metadata,
    });
    try {
      await this.prisma.ideaBlockEntity.create({
        data: {
          blockId: args.blockId,
          entityId: entity.id,
          mentionContext: args.mention.mentionContext,
          role: 'mentioned',
        },
      });
    } catch (err) {
      // P2002 — пара (blockId, entityId) уже существует. Это нормально:
      // одна и та же сущность могла упоминаться в нескольких контекстах
      // одного блока — фиксируем первый mentionContext, остальные skip.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return;
      }
      throw err;
    }
  }

  private toVectorLiteral(vec: number[]): string {
    return `[${vec.join(',')}]`;
  }

  private async onJobFailed(
    job: Job<RawEventJobData> | null,
    err: Error,
  ): Promise<void> {
    if (!job) return;
    if (job.attemptsMade < (job.opts.attempts ?? 5)) return;
    this.logger.error(
      {
        rawEventId: job.data.rawEventId,
        attempts: job.attemptsMade,
        err: err.message,
      },
      'block-ingest: финальный fail после всех ретраев',
    );
  }
}
