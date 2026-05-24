import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  type EntityType,
  Prisma,
  type RawEvent,
  type SignalType,
} from '@prisma/client';
import { type Job, Worker } from 'bullmq';

import { GraphService } from '../../../common/graph/graph.service';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';
import {
  CORE_QUEUE_NAMES,
  type RawEventJobData,
} from '../../core-queue/queues';
import { WorkerOrgGate } from '../../core-queue/worker-org-gate';
import { S3Service } from '../../recordings/s3.service';
import {
  ENTITY_TYPE_VALUES,
  SIGNAL_TYPE_VALUES,
} from '../prompts/block-ingest.prompt';
import {
  BlockExtractionService,
  type ExtractedBlock,
  type ExtractedEntityMention,
} from '../services/block-extraction.service';
import { KnowledgeEmbeddingService } from '../services/embedding.service';
import { EntityResolutionService } from '../services/entity-resolution.service';
import { AxisClassifierService } from '../services/axis-classifier.service';
import { RouterService } from '../services/router.service';
import { SegmentBuilderService } from '../services/segment-builder.service';

/**
 * Block-ingest worker (`core.raw-events` consumer).
 *
 * Шаги на job `{ rawEventId }`:
 *   1. findUnique RawEvent. Если null → skip.
 *   2. Idempotency: processingStatus !== 'received' → skip.
 *   3. Загружаем payload (inline или S3).
 *   4. Строим сегменты (SegmentBuilder).
 *   5. Извлекаем ExtractedBlock'и + типизированные сущности группы Б
 *      (BlockExtraction). Фаза 0b: один проход возвращает и блоки, и группу Б
 *      с `sourceBlockIndex` для провенанса.
 *   6. Эмбеддим блоки (один батч на все).
 *   7. На каждый блок — Prisma-транзакция:
 *      - create IdeaBlock + executeRaw embedding (с role_relevant + roleId
 *        после resolveRoleByHint).
 *      - create IdeaBlockEvidence.
 *      - upsert Entity'ев + create IdeaBlockEntity (skip P2002).
 *      - Если signalType='decision' и LLM не вернул отдельный Decision —
 *        fallback Decision-create (idempotent по sourceIdeaBlockId).
 *   8. Группа Б — для каждой сущности с confidence ≥ minConfidence:
 *      - GraphService.upsertEntity({ type, data, sourceProvenance }) — двойная
 *        запись в Postgres + AGE.
 *      - LLM-вернутые Decision'ы имеют приоритет над auto-create в шаге 7.
 *   9. Вне транзакции — enqueueBlockDistill(blockId).
 *  10. RawEvent → processingStatus='ingested', processedAt=now.
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
    @Inject(GraphService) private readonly graph: GraphService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(RouterService) private readonly router: RouterService,
    @Inject(AxisClassifierService)
    private readonly axisClassifier: AxisClassifierService,
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
      const extraction = await this.extractor.extractFull({
        tenantId: event.tenantId,
        rawEventId: event.id,
        meetingTitle,
        segments,
        // Фаза 11: dataClass наследуется от RawEvent.
        dataClass: event.dataClass,
      });
      // Sprint 3 B1-3.1: signalTypeHint override.
      // Если RawEvent.payload содержит `signalTypeHint` (TrackerAdapter,
      // в перспективе — другие адаптеры с детерминированным типом события),
      // принудительно используем его:
      //   - Если LLM вернул ≥1 блок: переопределяем signalType первого блока
      //     (наиболее «приоритетного» — обычно главный смысловой блок),
      //     остальные оставляем как есть (для task_comment LLM может извлечь
      //     дополнительные decisions/commitments — у них СВОЙ signalType,
      //     это правильно).
      //   - Если 0 блоков (компактное событие типа status_changed без
      //     текста, который LLM смог бы выделить): создаём один синтетический
      //     блок c hint-ом — чтобы графовая модель знала о факте события.
      const signalHint = this.tryGetSignalTypeHint(payload);
      const blocksInOrder = this.applySignalTypeHint(
        extraction.blocksInOrder,
        signalHint,
        payload,
      );
      const { typed } = extraction;
      this.logger.log(
        {
          rawEventId,
          segments: segments.length,
          blocks: blocksInOrder.length,
          signalTypeHint: signalHint,
          typedCounts: {
            processes: typed.processes.length,
            decisions: typed.decisions.length,
            regulations: typed.regulations.length,
            policies: typed.policies.length,
            metrics: typed.metrics.length,
            tools: typed.tools.length,
          },
        },
        'block-ingest: извлечение завершено',
      );

      const embeddings =
        blocksInOrder.length > 0
          ? await this.embeddings.embedBlocks(blocksInOrder)
          : [];

      // Маппинг: индекс блока в массиве (порядок LLM-выдачи) → реальный blockId.
      const indexToBlockId = new Map<number, string>();
      const blockIds: string[] = [];
      // Соберём id блоков, у которых signalType='decision' — для fallback-
      // Decision (если LLM не вернул отдельный decisions[] item).
      const decisionBlockIds = new Set<string>();

      for (let i = 0; i < blocksInOrder.length; i++) {
        const block = blocksInOrder[i] as ExtractedBlock;
        const vector = embeddings[i];

        // Резолвим roleId по roleHint (если есть и role_relevant=true).
        let roleId: string | null = null;
        if (block.role_relevant && block.roleHint) {
          roleId = await this.entities
            .resolveRoleByHint(event.tenantId, block.roleHint)
            .catch(() => null);
        }

        const blockId = await this.persistBlock({
          event,
          block,
          embedding: vector ?? null,
          roleRelevant: block.role_relevant && roleId !== null,
          roleId,
        });
        if (blockId) {
          blockIds.push(blockId);
          indexToBlockId.set(i, blockId);
          if (block.signalType === 'decision') {
            decisionBlockIds.add(blockId);
          }
        }
      }

      // ── Группа Б: типизированные сущности через GraphService.upsertEntity ──
      // Decision имеет приоритет: LLM-вернутый item затирает auto-create.
      const llmDecisionBlockIds = new Set<string>();

      // Process
      for (const proc of typed.processes) {
        try {
          const data: Record<string, unknown> = {
            name: proc.name,
            description: proc.description ?? null,
            triggerDescription: proc.triggerDescription ?? null,
          };
          if (proc.ownerRoleHint) {
            const ownerRoleId = await this.entities
              .resolveRoleByHint(event.tenantId, proc.ownerRoleHint)
              .catch(() => null);
            if (ownerRoleId) data['ownerRoleId'] = ownerRoleId;
          }
          const prov = this.provenance(event, indexToBlockId, proc.sourceBlockIndex);
          const res = await this.graph.upsertEntity({
            tenantId: event.tenantId,
            type: 'process',
            data,
            confidence: proc.confidence,
            sourceProvenance: prov,
          });
          await this.linkProvenance(event.tenantId, 'process', res.id, prov, proc.confidence);
          this.metrics.incExtractionEntity({ type: 'process' });
          this.metrics.observeExtractionConfidence({
            type: 'process',
            confidence: proc.confidence,
          });
          this.metrics.incEntityResolutionDedup({
            type: 'process',
            action: res.created ? 'created' : 'merged',
          });
        } catch (err) {
          this.warnTypedFail('process', proc.name, err);
        }
      }

      // Regulation
      // NB: GraphService.upsertEntity для regulation сейчас НЕ записывает
      // category, severity (для policy), kind (для tool), valueType (для metric)
      // — это hidden TODO в graph.service.ts upsertNameKeyedEntity. На MVP
      // выпадают на default-значения схемы. Расширить при первой пилотной нагрузке.
      for (const reg of typed.regulations) {
        try {
          const prov = this.provenance(event, indexToBlockId, reg.sourceBlockIndex);
          const res = await this.graph.upsertEntity({
            tenantId: event.tenantId,
            type: 'regulation',
            data: {
              name: reg.name,
              contentMd: reg.contentMd,
              category: reg.category,
            },
            confidence: reg.confidence,
            sourceProvenance: prov,
          });
          await this.linkProvenance(event.tenantId, 'regulation', res.id, prov, reg.confidence);
          this.metrics.incExtractionEntity({ type: 'regulation' });
          this.metrics.observeExtractionConfidence({
            type: 'regulation',
            confidence: reg.confidence,
          });
          this.metrics.incEntityResolutionDedup({
            type: 'regulation',
            action: res.created ? 'created' : 'merged',
          });
        } catch (err) {
          this.warnTypedFail('regulation', reg.name, err);
        }
      }

      // Policy
      for (const pol of typed.policies) {
        try {
          const prov = this.provenance(event, indexToBlockId, pol.sourceBlockIndex);
          const res = await this.graph.upsertEntity({
            tenantId: event.tenantId,
            type: 'policy',
            data: {
              name: pol.name,
              contentMd: pol.contentMd,
              severity: pol.severity,
            },
            confidence: pol.confidence,
            sourceProvenance: prov,
          });
          await this.linkProvenance(event.tenantId, 'policy', res.id, prov, pol.confidence);
          this.metrics.incExtractionEntity({ type: 'policy' });
          this.metrics.observeExtractionConfidence({
            type: 'policy',
            confidence: pol.confidence,
          });
          this.metrics.incEntityResolutionDedup({
            type: 'policy',
            action: res.created ? 'created' : 'merged',
          });
        } catch (err) {
          this.warnTypedFail('policy', pol.name, err);
        }
      }

      // Tool
      for (const tool of typed.tools) {
        try {
          const prov = this.provenance(event, indexToBlockId, tool.sourceBlockIndex);
          const res = await this.graph.upsertEntity({
            tenantId: event.tenantId,
            type: 'tool',
            data: {
              name: tool.name,
              kind: tool.kind,
              externalUrl: tool.externalUrl ?? null,
            },
            confidence: tool.confidence,
            sourceProvenance: prov,
          });
          await this.linkProvenance(event.tenantId, 'tool', res.id, prov, tool.confidence);
          this.metrics.incExtractionEntity({ type: 'tool' });
          this.metrics.observeExtractionConfidence({
            type: 'tool',
            confidence: tool.confidence,
          });
          this.metrics.incEntityResolutionDedup({
            type: 'tool',
            action: res.created ? 'created' : 'merged',
          });
        } catch (err) {
          this.warnTypedFail('tool', tool.name, err);
        }
      }

      // Metric
      for (const metric of typed.metrics) {
        try {
          const prov = this.provenance(event, indexToBlockId, metric.sourceBlockIndex);
          const res = await this.graph.upsertEntity({
            tenantId: event.tenantId,
            type: 'metric',
            data: {
              name: metric.name,
              description: metric.description ?? null,
              unit: metric.unit,
              target: metric.target ?? null,
              valueType: metric.valueType,
            },
            confidence: metric.confidence,
            sourceProvenance: prov,
          });
          await this.linkProvenance(event.tenantId, 'metric', res.id, prov, metric.confidence);
          this.metrics.incExtractionEntity({ type: 'metric' });
          this.metrics.observeExtractionConfidence({
            type: 'metric',
            confidence: metric.confidence,
          });
          this.metrics.incEntityResolutionDedup({
            type: 'metric',
            action: res.created ? 'created' : 'merged',
          });
        } catch (err) {
          this.warnTypedFail('metric', metric.name, err);
        }
      }

      // Decision (приоритет за LLM-вернутыми)
      for (const dec of typed.decisions) {
        try {
          const sourceBlockId =
            dec.sourceBlockIndex != null
              ? indexToBlockId.get(dec.sourceBlockIndex) ?? null
              : null;

          // decidedAt: ISO8601 строка или null → дата rawEvent.occurredAt.
          const decidedAt = this.parseDecidedAt(dec.decidedAt) ?? event.occurredAt;

          // decidedByPersonId: резолвим из decidedByPersonHint.
          let decidedByPersonId: string | undefined;
          if (dec.decidedByPersonHint) {
            const personId = await this.entities
              .resolvePersonByHint(event.tenantId, dec.decidedByPersonHint)
              .catch(() => null);
            if (personId) decidedByPersonId = personId;
          }

          const decisionData: Record<string, unknown> = {
            text: dec.text,
            decidedAt,
            rationale: dec.rationale ?? null,
            sourceMeetingId:
              event.sourceType === 'meeting' ? event.sourceExternalId : null,
          };
          if (sourceBlockId) decisionData['sourceIdeaBlockId'] = sourceBlockId;
          if (decidedByPersonId) decisionData['decidedByPersonId'] = decidedByPersonId;

          const res = await this.graph.upsertEntity({
            tenantId: event.tenantId,
            type: 'decision',
            data: decisionData,
            confidence: dec.confidence,
            sourceProvenance: this.provenance(event, indexToBlockId, dec.sourceBlockIndex),
          });
          this.metrics.incExtractionEntity({ type: 'decision' });
          this.metrics.observeExtractionConfidence({
            type: 'decision',
            confidence: dec.confidence,
          });
          this.metrics.incEntityResolutionDedup({
            type: 'decision',
            action: res.created ? 'created' : 'merged',
          });
          if (sourceBlockId) llmDecisionBlockIds.add(sourceBlockId);
        } catch (err) {
          this.warnTypedFail('decision', dec.text.slice(0, 80), err);
        }
      }

      // Fallback Decision-create для блоков signalType='decision', по которым
      // LLM не вернул отдельную запись в decisions[]. Idempotent по
      // sourceIdeaBlockId (upsertEntity сам проверяет существование).
      for (const blockId of decisionBlockIds) {
        if (llmDecisionBlockIds.has(blockId)) continue;
        const block = blocksInOrder.find(
          (_, idx) => indexToBlockId.get(idx) === blockId,
        );
        if (!block) continue;
        try {
          const res = await this.graph.upsertEntity({
            tenantId: event.tenantId,
            type: 'decision',
            data: {
              text: block.trustedAnswer,
              decidedAt: event.occurredAt,
              sourceIdeaBlockId: blockId,
              sourceMeetingId:
                event.sourceType === 'meeting' ? event.sourceExternalId : null,
            },
            confidence: block.confidence,
            sourceProvenance: {
              rawEventId: event.id,
              ideaBlockId: blockId,
            },
          });
          if (res.created) {
            this.metrics.incExtractionEntity({ type: 'decision' });
            this.metrics.observeExtractionConfidence({
              type: 'decision',
              confidence: block.confidence,
            });
            this.metrics.incEntityResolutionDedup({
              type: 'decision',
              action: 'created',
            });
          }
        } catch (err) {
          this.warnTypedFail('decision (fallback)', block.trustedAnswer.slice(0, 80), err);
        }
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

      // SBA α-3 — RouterService.dispatch для каждого блока. Best-effort:
      // не блокирует основной pipeline (dispatch внутри уже не throw'ит).
      // На α-3 consumer'ы ещё не существуют — jobs накапливаются.
      // SBA α-3 wave 3 — после router.dispatch вызываем AxisClassifier
      // (синхронно, idempotent по unique (tenantId, blockId, axis, label)).
      for (let i = 0; i < blocksInOrder.length; i++) {
        const block = blocksInOrder[i] as ExtractedBlock;
        const blockId = indexToBlockId.get(i);
        if (!blockId) continue;
        await this.router
          .dispatch({
            id: blockId,
            tenantId: event.tenantId,
            signalType: block.signalType,
          })
          .catch((err) => {
            this.logger.warn(
              {
                blockId,
                err: err instanceof Error ? err.message : String(err),
              },
              'block-ingest: RouterService.dispatch упал — продолжаем без роутинга',
            );
          });
        // SBA α-3 wave 3 — AxisClassifier (внутри не throw'ит).
        await this.axisClassifier
          .classify({
            blockId,
            tenantId: event.tenantId,
            signalType: block.signalType,
          })
          .catch((err) => {
            this.logger.warn(
              {
                blockId,
                err: err instanceof Error ? err.message : String(err),
              },
              'block-ingest: AxisClassifier.classify упал — продолжаем без axis-меток',
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
   * Sprint 3 B1-3.1 — извлечение `signalTypeHint` из payload (TrackerAdapter
   * проставляет его как явное указание signalType, чтобы worker не зависел
   * от LLM-классификации для детерминированных событий трекера).
   * Возвращает null, если поле отсутствует или значение не из enum SignalType.
   */
  private tryGetSignalTypeHint(payload: unknown): SignalType | null {
    if (typeof payload !== 'object' || payload === null) return null;
    const v = (payload as { signalTypeHint?: unknown }).signalTypeHint;
    if (typeof v !== 'string') return null;
    if (!(SIGNAL_TYPE_VALUES as readonly string[]).includes(v)) return null;
    return v as SignalType;
  }

  /**
   * Применить signalTypeHint к результатам LLM-извлечения:
   *   - 0 блоков + есть hint → создаём один синтетический блок (контекст из
   *     payload.issue.title / payload.fullText / eventType).
   *   - ≥1 блок + есть hint → переопределяем signalType ПЕРВОГО блока на
   *     hint. Остальные оставляем — LLM может выделить decisions/commitments/
   *     ideas со СВОИМИ signalType (это и есть ценность LLM-прохода для
   *     task_comment / task_created).
   *   - hint=null → ничего не меняем.
   */
  private applySignalTypeHint(
    blocks: ExtractedBlock[],
    hint: SignalType | null,
    payload: unknown,
  ): ExtractedBlock[] {
    if (!hint) return blocks;
    if (blocks.length === 0) {
      const synthetic = this.buildSyntheticBlock(hint, payload);
      return synthetic ? [synthetic] : [];
    }
    const overridden = [...blocks];
    const first = overridden[0];
    if (first) {
      overridden[0] = { ...first, signalType: hint };
    }
    return overridden;
  }

  /**
   * Создаёт минимальный синтетический ExtractedBlock из payload для тех
   * событий, в которых LLM не нашёл смыслового контента (например,
   * task_status_changed: «KORA-12 переведена в blocked»). Без LLM —
   * детерминированно, на основе полей payload.
   */
  private buildSyntheticBlock(
    hint: SignalType,
    payload: unknown,
  ): ExtractedBlock | null {
    if (typeof payload !== 'object' || payload === null) return null;
    const p = payload as {
      issue?: { identifier?: string; title?: string };
      eventType?: string;
      meta?: Record<string, unknown>;
      fullText?: string;
    };
    const identifier = p.issue?.identifier ?? 'task';
    const title = p.issue?.title ?? '(без заголовка)';
    const eventType = p.eventType ?? hint;
    const baseText = p.fullText
      ? p.fullText
      : `Задача ${identifier} «${title}» — событие: ${eventType}`;
    return {
      name: `${identifier}: ${eventType}`.slice(0, 200),
      criticalQuestion: `Что произошло с задачей ${identifier} и какие выводы?`,
      trustedAnswer: baseText.slice(0, 4000),
      signalType: hint,
      tags: [],
      confidence: 0.95,
      evidenceQuote: baseText.slice(0, 1000),
      evidenceStartMs: 0,
      evidenceEndMs: 0,
      mentionedEntities: [],
      role_relevant: false,
      roleHint: undefined,
    };
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
    roleRelevant: boolean;
    roleId: string | null;
  }): Promise<string | null> {
    const { event, block, embedding, roleRelevant, roleId } = args;
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
            roleRelevant,
            roleId,
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

  // ─────────────────────────── helpers (group Б) ───────────────────────────

  /**
   * Собирает provenance для GraphService.upsertEntity. Источник documentId:
   *   - `sourceExternalId='doc:<id>'` (`DocumentIngestAdapter` использует
   *     этот префикс при создании RawEvent — см. document.adapter.ts).
   *   - Либо `payload.documentId` (text.adapter и document.adapter оба кладут
   *     его в payload).
   *
   * Если sourceType='meeting'/'chat'/...'` — documentId отсутствует.
   */
  private provenance(
    event: RawEvent,
    indexToBlockId: Map<number, string>,
    sourceBlockIndex: number | null,
  ): { rawEventId: string; ideaBlockId?: string; documentId?: string } {
    const result: {
      rawEventId: string;
      ideaBlockId?: string;
      documentId?: string;
    } = { rawEventId: event.id };
    if (sourceBlockIndex != null) {
      const bid = indexToBlockId.get(sourceBlockIndex);
      if (bid) result.ideaBlockId = bid;
    }
    // Извлекаем documentId. document.adapter / text.adapter оба используют
    // `sourceExternalId='doc:<id>'`.
    const ext = event.sourceExternalId;
    if (typeof ext === 'string' && ext.startsWith('doc:')) {
      result.documentId = ext.slice('doc:'.length);
    }
    return result;
  }

  private parseDecidedAt(input: string | null | undefined): Date | null {
    if (!input) return null;
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /**
   * Безопасный warn для падений группы Б — мы не валим весь job из-за
   * одной кривой сущности, но детально логируем для аудита.
   */
  private warnTypedFail(type: string, name: string, err: unknown): void {
    this.logger.warn(
      {
        type,
        name,
        err: err instanceof Error ? err.message : String(err),
      },
      'block-ingest: типизированная сущность группы Б не сохранилась — пропуск',
    );
  }

  /**
   * Создаёт типизированное ребро `derived_from` от извлечённой сущности
   * (Process/Regulation/Policy/Metric/Tool) к Document (если provenance
   * содержит documentId).
   *
   * Это даёт API `/documents/:id` возможность вернуть «какие сущности
   * группы Б извлечены из этого документа» через `EntityLink.findMany`
   * (см. DocumentsService.getDetail).
   *
   * На ошибку — только warn, не валим pipeline (provenance — best-effort).
   */
  private async linkProvenance(
    tenantId: string,
    fromType: 'process' | 'regulation' | 'policy' | 'metric' | 'tool',
    fromId: string,
    prov: { documentId?: string; ideaBlockId?: string },
    confidence: number,
  ): Promise<void> {
    if (!prov.documentId) return;
    try {
      await this.graph.addEdge({
        tenantId,
        from: { type: fromType, id: fromId },
        to: { type: 'document', id: prov.documentId },
        linkType: 'derived_from',
        confidence,
        explanation: 'извлечено из документа (block-ingest v2)',
        createdBy: 'linker',
      });
    } catch (err) {
      this.logger.warn(
        {
          fromType,
          fromId,
          documentId: prov.documentId,
          err: err instanceof Error ? err.message : String(err),
        },
        'block-ingest: derived_from-ребро не создалось — пропуск (provenance best-effort)',
      );
    }
  }
}
