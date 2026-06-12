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


import { TypedConfigService } from '../../../common/config/index';
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
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { S3Service } from '../../recordings/s3.service';
import {
  ENTITY_TYPE_VALUES,
  SIGNAL_TYPE_VALUES,
} from '../prompts/block-ingest.prompt';
import { AxisClassifierService } from '../services/axis-classifier.service';
import { BlockAccessDeriverService } from '../services/block-access-deriver.service';
import {
  BlockExtractionService,
  type ExtractedBlock,
  type ExtractedEntityMention,
} from '../services/block-extraction.service';
import { KnowledgeEmbeddingService } from '../services/embedding.service';
import { EntityResolutionService } from '../services/entity-resolution.service';
import {
  SegmentBuilderService,
  type Segment,
} from '../services/segment-builder.service';

/**
 * Фаза 1.2 (meeting-identity & clones-attribution) — типы сигналов-рассуждений,
 * для которых автор детерминированно помечается `IdeaBlockEntity.role='subject'`
 * (оживление ролевых клонов: Specialist 3-7 / ExecutablePersona читают первые 3).
 * Все 6 значений существуют в enum `SignalType` (schema.prisma).
 */
const REASONING_SUBJECT_SIGNAL_TYPES: ReadonlySet<string> = new Set([
  'reasoning',
  'rationale',
  'decision_basis',
  'expertise',
  'experience',
  'competence',
]);

/**
 * KC-Temporal W1.4 (2026-05-25) — типизированный спан-уровневый провенанс.
 * Сохраняется в `IdeaBlock.propertySpans` как JSON-массив.
 *
 *   - `field` — какое property блока подсвечивается (`name`/`criticalQuestion`/
 *     `trustedAnswer`/`mentionedEntity`). На MVP block-ingest пишет только
 *     `mentionedEntity` (entity-чипы → прыжок плеера).
 *   - `refId` — id связанной сущности (опц.). При insert worker'ом не пишется
 *     (entity-resolution идёт вне транзакции); может быть выставлено позже.
 *   - `evidenceId` — обязательная связь со свидетельством (через который
 *     UI знает, какой timecode проигрывать).
 *   - `startMs` / `endMs` — таймкоды цитаты внутри source-медиа.
 */
export interface PropertySpan {
  field: 'name' | 'criticalQuestion' | 'trustedAnswer' | 'mentionedEntity';
  refId?: string;
  evidenceId: string;
  startMs: number;
  endMs: number;
}

/**
 * МТЗ «разблокировка конвейера» Ф5 — классификация причины провала записи
 * типизированной сущности группы Б.
 *
 *   - `age_unavailable` — СИСТЕМНЫЙ отказ графа: `cypher()` не резолвится
 *     (рантайм-пул без `ag_catalog` в search_path → Postgres 42883
 *     `function cypher does not exist`), либо иной сбой обращения к `z_graph`.
 *     После развязки транзакции (Ф5) бизнес-строка переживает это, НО факт
 *     отказа графа значим: block-ingest НЕ помечает RawEvent='ingested',
 *     а уводит job в failed → BullMQ ретрайнет после восстановления AGE.
 *   - `idempotent_skip` — Prisma `P2002` (unique violation) при гонке
 *     concurrency=2: сущность уже создана параллельным джобом — норма, не отказ.
 *   - `validation_error` — невалидные данные сущности (BadRequest/Zod):
 *     извлечение кривое, ретрай не поможет — не системный отказ.
 *   - `other` — всё остальное.
 */
export type TypedFailReason =
  | 'age_unavailable'
  | 'idempotent_skip'
  | 'validation_error'
  | 'other';

export function classifyTypedFailReason(err: unknown): TypedFailReason {
  // P2002 (unique violation при гонке concurrency) — идемпотентный skip.
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2002'
  ) {
    return 'idempotent_skip';
  }

  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();

  // Системный отказ графа AGE: cypher() не резолвится / ошибка z_graph.
  if (
    message.includes('cypher') ||
    message.includes('z_graph') ||
    message.includes('function cypher') ||
    message.includes('42883') ||
    message.includes('ag_catalog') ||
    message.includes('agtype')
  ) {
    return 'age_unavailable';
  }

  // P2002 по message (на случай, если ошибка завёрнута и instanceof не сработал).
  if (message.includes('p2002') || message.includes('unique constraint')) {
    return 'idempotent_skip';
  }

  // Валидационные ошибки извлечённой сущности.
  const errName =
    err instanceof Error ? err.constructor?.name ?? err.name : '';
  if (
    errName === 'ValidationError' ||
    errName === 'ZodError' ||
    errName === 'BadRequestException' ||
    message.includes('validation') ||
    message.includes('required')
  ) {
    return 'validation_error';
  }

  return 'other';
}

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

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

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
    @Inject(AxisClassifierService)
    private readonly axisClassifier: AxisClassifierService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    // Ф3 (knowledge-access) — детерминированный вывод групп доступа блока.
    @Inject(BlockAccessDeriverService)
    private readonly blockAccessDeriver: BlockAccessDeriverService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<RawEventJobData>(
      CORE_QUEUE_NAMES.RAW_EVENTS,
      async (job) =>
        this.pipe.job(SystemLogPipeline.KNOWLEDGE_GRAPH, 'kc.block-ingest', job, () =>
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
      // Ф1 (knowledge-access) — per-adapter identity автора события
      // (tracker/chatbox/dump/free_note/email). Заменяет узкий tryGetAuthorUserId.
      const authorIdentity = this.tryGetActorIdentity(payload);
      // Ф1 — флаг расширенной привязки автора на ВСЕ signalType (code-fallback true).
      const subjectAllTypes = await this.cfg.getDynamic<boolean>(
        'knowledge.subjectAttributionAllTypes',
        undefined,
        true,
      );
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
      // Report-to-graph Ф4 ГАРД A — на report-пути синтетику НЕ форсим:
      // отчёт вторичен, пусть LLM извлекает реальные блоки; нет блоков —
      // нет блоков. Синтетика остаётся только для трекер-событий.
      const isReportEvent = event.sourceType === 'meeting_report';
      const blocksInOrder = this.applySignalTypeHint(
        extraction.blocksInOrder,
        signalHint,
        payload,
        isReportEvent,
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
      // Ф1 idea direct-path: blockId → embedding блока (переиспользуем уже
      // посчитанный vector, чтобы тонкая Idea была KNN-discoverable).
      const ideaEmbeddingByBlockId = new Map<string, number[] | null>();

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
          segments,
          authorUserId: authorIdentity.authorUserId,
          authorPersonId: authorIdentity.authorPersonId,
          authorEmail: authorIdentity.authorEmail,
          subjectAllTypes,
        });
        if (blockId) {
          blockIds.push(blockId);
          indexToBlockId.set(i, blockId);
          if (block.signalType === 'decision') {
            decisionBlockIds.add(blockId);
          }
          if (block.signalType === 'idea') {
            ideaEmbeddingByBlockId.set(blockId, vector ?? null);
          }
        }
      }

      // ── ТЗ-4 Ф4: документная привязка в граф ──
      // Явная привязка человека при загрузке документа (attachedRoleId /
      // attachedThemeId) перебивает LLM-роль и связывает блоки документа с темой.
      // Только для doc-источника. Применяется ДАЖЕ если LLM не вернул ни одной
      // роли (в этом и смысл — явная атрибуция действует независимо от извлечения).
      // Best-effort: ошибка не валит ingest. См. applyDocumentAttribution.
      await this.applyDocumentAttribution(event, payload, blockIds).catch((err) => {
        this.logger.warn(
          { rawEventId, err: err instanceof Error ? err.message : String(err) },
          'block-ingest: документная привязка (ТЗ-4 Ф4) не удалась — пропуск',
        );
      });

      // ── Группа Б: типизированные сущности через GraphService.upsertEntity ──
      // Decision имеет приоритет: LLM-вернутый item затирает auto-create.
      const llmDecisionBlockIds = new Set<string>();

      // МТЗ Ф5 — аккумулятор СИСТЕМНОГО отказа графа. Если хоть одна сущность
      // группы Б упала с reason='age_unavailable' (cypher не резолвится),
      // НЕ помечаем RawEvent='ingested' (см. ниже) — job уйдёт в failed и
      // BullMQ ретрайнет после восстановления AGE (вместо тихой потери).
      let systemFailure = false;

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
          if (this.warnTypedFail('process', proc.name, err) === 'age_unavailable')
            systemFailure = true;
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
          if (this.warnTypedFail('regulation', reg.name, err) === 'age_unavailable')
            systemFailure = true;
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
          if (this.warnTypedFail('policy', pol.name, err) === 'age_unavailable')
            systemFailure = true;
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
          if (this.warnTypedFail('tool', tool.name, err) === 'age_unavailable')
            systemFailure = true;
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
          if (this.warnTypedFail('metric', metric.name, err) === 'age_unavailable')
            systemFailure = true;
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
          if (
            this.warnTypedFail('decision', dec.text.slice(0, 80), err) ===
            'age_unavailable'
          )
            systemFailure = true;
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
          if (
            this.warnTypedFail(
              'decision (fallback)',
              block.trustedAnswer.slice(0, 80),
              err,
            ) === 'age_unavailable'
          )
            systemFailure = true;
        }
      }

      // ── Ф1 idea direct-path (за kill-switch knowledge.ideaDirectPathEnabled) ──
      // Детерминированная материализация Idea из блоков signalType='idea',
      // чтобы Идея не зависела на 100% от 2-го LLM-вызова Specialist 3.6
      // (extractDraft может упасть/отсеять по confidence<0.4 → Идея терялась).
      // Идемпотентно по sourceBlockId; дубль против Specialist 3.6 исключён
      // его guard'ом (он обогащает, а не создаёт второй раз).
      if (this.cfg.knowledgeCore.ideaDirectPathEnabled && ideaEmbeddingByBlockId.size > 0) {
        const ideaCandidateIds = [...ideaEmbeddingByBlockId.keys()];
        // Уже материализованные блоки (повторный прогон / частичный сбой).
        const existingIdeas = await this.prisma.idea.findMany({
          where: { tenantId: event.tenantId, sourceBlockIds: { hasSome: ideaCandidateIds } },
          select: { sourceBlockIds: true },
        });
        const coveredBlockIds = new Set<string>();
        for (const it of existingIdeas) for (const bid of it.sourceBlockIds) coveredBlockIds.add(bid);

        const toCreate = ideaCandidateIds.filter((bid) => !coveredBlockIds.has(bid));
        if (toCreate.length > 0) {
          const rows = await this.prisma.ideaBlock.findMany({
            where: { id: { in: toCreate } },
            select: { id: true, tenantId: true, trustedAnswer: true, confidence: true, dataClass: true, createdAt: true },
          });
          let createdAny = false;
          for (const row of rows) {
            const statement = (row.trustedAnswer ?? '').trim();
            if (!statement) continue; // пустую идею не материализуем
            try {
              const conf = Math.max(0, Math.min(1, Number(row.confidence)));
              const idea = await this.prisma.idea.create({
                data: {
                  tenantId: row.tenantId,
                  kind: 'internal',
                  statement,
                  rationale: null,
                  weight: new Prisma.Decimal(1.5),
                  supporterCount: 1,
                  firstProposedAt: row.createdAt,
                  lastDiscussedAt: row.createdAt,
                  status: 'captured',
                  sourceBlockIds: [row.id],
                  confidence: new Prisma.Decimal(conf),
                  dataClass: row.dataClass,
                  createdByUserId: null,
                },
              });
              createdAny = true;
              this.metrics.incExtractionEntity({ type: 'idea' });
              // Переиспользуем embedding блока → Idea KNN-discoverable.
              const emb = ideaEmbeddingByBlockId.get(row.id);
              if (emb && emb.length > 0) {
                try {
                  const vecStr = `[${emb.join(',')}]`;
                  await this.prisma.$executeRawUnsafe(
                    `UPDATE "ideas" SET "embedding" = $1::vector WHERE "id" = $2`,
                    vecStr,
                    idea.id,
                  );
                } catch {
                  // graceful — embedding не критичен для существования идеи
                }
              }
            } catch (err) {
              this.logger.warn(
                { blockId: row.id, err: err instanceof Error ? err.message : String(err) },
                'block-ingest: idea direct-path create упал — пропуск блока',
              );
            }
          }
          if (createdAny) {
            try {
              await this.coreQueue.enqueueIdeaClusterer({ tenantId: event.tenantId });
            } catch {
              // graceful
            }
          }
        }
      }

      // МТЗ Ф5 — при СИСТЕМНОМ отказе графа (age_unavailable) НЕ помечаем
      // RawEvent='ingested'. Бизнес-строки (IdeaBlock + те сущности, что
      // прошли) уже сохранены — повторный заход джоба идемпотентен (skip
      // существующих по unique-ключам), а вот пометка ingested здесь была бы
      // тихой потерей графовой записи. Бросаем — сработает внешний catch
      // (processingStatus='failed') и BullMQ ретрайнет после восстановления
      // AGE. idempotent_skip/validation_error/other системным отказом НЕ
      // считаются — для них ingested ставится как раньше.
      if (systemFailure) {
        throw new Error(
          'block-ingest: системный отказ графа AGE (cypher не резолвится) — ' +
            'RawEvent НЕ помечен ingested, job уходит в failed для ретрая ' +
            'после восстановления AGE',
        );
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

      // SBA α-3 wave 3 — AxisClassifier для каждого блока (синхронно,
      // idempotent по unique (tenantId, blockId, axis, label)). Работает на
      // draft-блоке корректно.
      //
      // Ф3 МТЗ «разблокировка конвейера» (баг #15/#23) — RouterService.dispatch
      // ОТСЮДА УБРАН. Раньше диспатч шёл на свежесозданный `status='draft'`
      // блок, а специалисты обрабатывают только `canonical` (skip на draft) →
      // первая проекция не рождалась из живого потока. Теперь диспатч делает
      // block-distill на переходе draft→canonical (markCanonical / mergeInto).
      for (let i = 0; i < blocksInOrder.length; i++) {
        const block = blocksInOrder[i] as ExtractedBlock;
        const blockId = indexToBlockId.get(i);
        if (!blockId) continue;
        // AxisClassifier (внутри не throw'ит).
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

        // Ф3 knowledge-access — детерминированный вывод групп доступа блока
        // (department из домена/участников/автора + closed из типа/флага встречи).
        // Пишется ВСЕГДА (не за enforcement) — данные готовы к будущему enforce.
        // best-effort: ошибка не валит ingest. ВАЖНО: после classify — чтобы
        // functional-axis-метки уже были записаны (department-путь читает их).
        await this.blockAccessDeriver
          .deriveForBlock({
            tenantId: event.tenantId,
            blockId,
            sourceType: event.sourceType,
            sourceExternalId: event.sourceExternalId ?? '',
            payload,
          })
          .catch((err) => {
            this.logger.warn(
              { blockId, err: err instanceof Error ? err.message : String(err) },
              'block-ingest: deriveBlockAccess упал — продолжаем без групп доступа',
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
   * Фаза 1.2 — извлечение автора текстовых каналов (free_note / in_app):
   * `payload.userId` — id пользователя, написавшего заметку/сообщение. Несёт
   * identity автора для атрибуции `role='subject'` в text-источниках.
   * Возвращает null, если поле отсутствует/пустое/не строка (встречи —
   * атрибуция идёт по `speakerParticipantId` сегмента, не отсюда).
   */
  private tryGetAuthorUserId(payload: unknown): string | null {
    if (typeof payload !== 'object' || payload === null) return null;
    const v = (payload as { userId?: unknown }).userId;
    return typeof v === 'string' && v.trim().length > 0 ? v : null;
  }

  /**
   * Ф1 (knowledge-access) — извлечение identity АВТОРА события из payload для
   * детерминированной subject-атрибуции на ВСЕ типы знания. Per-adapter формы:
   *   - tracker:   payload.actor.userId   → authorUserId
   *   - chatbox:   payload.responsible.personId (linkedPersonId менеджера) → authorPersonId
   *   - dump/text: payload.uploaderId (Person.id) → authorPersonId
   *   - free_note/in_app: payload.userId (User.id) → authorUserId (как раньше)
   *   - email:     payload.from.address (почта) → authorEmail
   * Возвращает все три поля (null если не найдено). Резолв в Person/Entity —
   * EntityResolutionService.resolveSubjectEntityId (best-effort).
   */
  private tryGetActorIdentity(payload: unknown): {
    authorUserId: string | null;
    authorPersonId: string | null;
    authorEmail: string | null;
  } {
    const empty = {
      authorUserId: null,
      authorPersonId: null,
      authorEmail: null,
    };
    if (typeof payload !== 'object' || payload === null) return empty;
    const p = payload as Record<string, unknown>;

    // chatbox с per-message сегментацией (transcript.turns с authorPersonId) —
    // НЕ отдаём session-level authorPersonId: subject пишется по говорящему
    // сегмента в attributeSubject (fail-closed по клиентским репликам).
    const t = p['transcript'];
    const turns =
      t && typeof t === 'object'
        ? (t as { turns?: unknown }).turns
        : undefined;
    const hasPerMessageAuthors =
      Array.isArray(turns) &&
      turns.some(
        (tn) =>
          tn !== null &&
          typeof tn === 'object' &&
          'authorPersonId' in (tn as Record<string, unknown>),
      );

    // tracker — actor.userId
    const actor = p['actor'];
    if (actor && typeof actor === 'object') {
      const uid = (actor as { userId?: unknown }).userId;
      if (typeof uid === 'string' && uid.trim().length > 0) {
        return { ...empty, authorUserId: uid };
      }
    }
    // chatbox — responsible.personId (linkedPersonId). При per-message
    // сегментации session-level автор НЕ отдаётся (fail-open на клиентские
    // реплики) — проваливаемся дальше; subject ставится по сегменту.
    const resp = p['responsible'];
    if (resp && typeof resp === 'object' && !hasPerMessageAuthors) {
      const pid = (resp as { personId?: unknown }).personId;
      if (typeof pid === 'string' && pid.trim().length > 0) {
        return { ...empty, authorPersonId: pid };
      }
    }
    // dump/text — uploaderId (Person.id)
    const uploaderId = p['uploaderId'];
    if (typeof uploaderId === 'string' && uploaderId.trim().length > 0) {
      return { ...empty, authorPersonId: uploaderId };
    }
    // free_note/in_app — userId (как было)
    const userId = this.tryGetAuthorUserId(payload);
    if (userId) return { ...empty, authorUserId: userId };
    // email — from.address
    const from = p['from'];
    if (from && typeof from === 'object') {
      const addr = (from as { address?: unknown }).address;
      if (typeof addr === 'string' && addr.includes('@')) {
        return { ...empty, authorEmail: addr };
      }
    }
    return empty;
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
    isReportEvent = false,
  ): ExtractedBlock[] {
    if (!hint) return blocks;
    if (blocks.length === 0) {
      // Report-to-graph Ф4 ГАРД A — для отчёта встречи синтетику НЕ создаём
      // (вторичный источник; нет извлечённых блоков — оставляем пусто).
      if (isReportEvent) return [];
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
    segments: Segment[];
    authorUserId: string | null;
    authorPersonId?: string | null;
    authorEmail?: string | null;
    subjectAllTypes?: boolean;
  }): Promise<string | null> {
    const { event, block, embedding, roleRelevant, roleId } = args;
    try {
      // SBA β-8.2 — для блоков обещаний сразу выставляем commitmentStatus и
      // (опц.) commitmentDueDate из LLM-подсказки. Адресата вычисляем
      // после блока — fuzzy match не должен ронять persist основного блока.
      const isCommitment = block.signalType === 'commitment';
      const commitmentDueDate = isCommitment
        ? this.parseGuessedDueDate(block.commitmentDueDateGuess)
        : null;

      // KC-Temporal W1.1: при включённом флаге проставляем validFrom из
      // первого evidence (для одиночного evidence — это event.occurredAt).
      // Если флаг выключен — оставляем null, backfill-скрипт заполнит позже.
      const bitemporalEnabled = this.cfg.bitemporal.enabled;
      const validFromValue: Date | null = bitemporalEnabled ? event.occurredAt : null;

      // Report-to-graph Ф4 ГАРД A — пониженный trust блоков из отчёта встречи.
      // Отчёт — ВТОРИЧНЫЙ источник относительно транскрипта (первичный,
      // дословный). Детерминированно по event.sourceType, а не по soft-тегу:
      //   - confidence: cap сверху крутилкой knowledge.reportBlockConfidenceCap
      //     (code-fallback 0.6) — report никогда не получает высокую уверенность.
      //   - primarySource: 'report' для отчёта, 'transcript' иначе — машинно
      //     различимый провенанс для гардов merge/distill (summariseBlock слеп
      //     к источнику, поэтому нужен явный признак на самом блоке).
      //   - dynamicScore: report стартует ниже (0.7) транскриптного primary (1.0),
      //     поэтому ранжируется ниже в поиске/клонах/дашборде.
      // Транскриптная ветка (isReport=false) остаётся ПОБИТОВО прежней:
      // confidence как из LLM, dynamicScore не переопределяется (дефолт 1.0).
      const isReport = event.sourceType === 'meeting_report';
      const reportConfidenceCap = isReport
        ? await this.cfg.getDynamic<number>(
            'knowledge.reportBlockConfidenceCap',
            undefined,
            0.6,
          )
        : 1;
      const effectiveConfidence = isReport
        ? Math.min(block.confidence, reportConfidenceCap)
        : block.confidence;

      const blockId = await this.prisma.$transaction(async (tx) => {
        const ideaBlock = await tx.ideaBlock.create({
          data: {
            tenantId: event.tenantId,
            name: block.name.slice(0, 200),
            criticalQuestion: block.criticalQuestion,
            trustedAnswer: block.trustedAnswer,
            tags: block.tags,
            signalType: block.signalType,
            confidence: new Prisma.Decimal(effectiveConfidence.toFixed(3)),
            dataClass: event.dataClass,
            status: 'draft',
            evidenceCount: 1,
            roleRelevant,
            roleId,
            primarySource: isReport ? 'report' : 'transcript',
            ...(isReport ? { dynamicScore: new Prisma.Decimal('0.7') } : {}),
            ...(validFromValue !== null ? { validFrom: validFromValue } : {}),
            ...(isCommitment
              ? {
                  commitmentStatus: 'open',
                  commitmentDueDate: commitmentDueDate ?? null,
                }
              : {}),
          },
        });
        if (embedding && embedding.length > 0) {
          await tx.$executeRawUnsafe(
            'UPDATE "IdeaBlock" SET embedding = $1::vector(1536) WHERE id = $2',
            this.toVectorLiteral(embedding),
            ideaBlock.id,
          );
        }
        const evidence = await tx.ideaBlockEvidence.create({
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
        // KC-Temporal W1.4: маппим LLM-output mentionedEntities[*].sourceSpan
        // → propertySpans (требует evidenceId, поэтому ПОСЛЕ создания evidence).
        // Best-effort: если LLM не вернул ни одного span — пропускаем UPDATE.
        const propertySpansValue = this.buildPropertySpans(block, evidence.id);
        if (propertySpansValue !== null && propertySpansValue.length > 0) {
          await tx.ideaBlock.update({
            where: { id: ideaBlock.id },
            data: {
              propertySpans: propertySpansValue as unknown as Prisma.InputJsonValue,
            },
          });
        }
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

      // SBA β-8.2 — для commitment пытаемся сопоставить адресата с Person
      // через fuzzy match. Best-effort: ошибка не валит persist.
      if (isCommitment && block.commitmentRecipientNameGuess) {
        await this.linkCommitmentRecipient({
          tenantId: event.tenantId,
          blockId,
          nameGuess: block.commitmentRecipientNameGuess,
        }).catch((err) => {
          this.logger.warn(
            {
              blockId,
              nameGuess: block.commitmentRecipientNameGuess,
              err: err instanceof Error ? err.message : String(err),
            },
            'block-ingest: commitmentRecipient не сопоставлен — пропуск',
          );
        });
      }

      // ТЗ-D — детерминированная атрибуция АВТОРА обещания (кто дал слово) по
      // identity спикера сегмента / payload.userId. Best-effort: ошибка или
      // выключенный kill-switch не валит persist. LLM-промпт НЕ трогается.
      if (isCommitment && blockId) {
        await this.attributeCommitmentAuthor({
          event,
          block,
          blockId,
          segments: args.segments,
          authorUserId: args.authorUserId,
          authorPersonId: args.authorPersonId ?? null,
          authorEmail: args.authorEmail ?? null,
        }).catch((err) => {
          this.logger.warn(
            {
              blockId,
              err: err instanceof Error ? err.message : String(err),
            },
            'block-ingest: атрибуция автора обещания не удалась — пропуск',
          );
        });
      }

      // Фаза 1.2 — детерминированная атрибуция автора (role='subject') для
      // блоков-рассуждений. Best-effort: ошибка/выключенный kill-switch не
      // валит persist основного блока. LLM-промпт НЕ трогается — атрибуция
      // идёт по identity сегмента (meeting) / payload.userId (text).
      if (
        blockId &&
        (args.subjectAllTypes === true ||
          REASONING_SUBJECT_SIGNAL_TYPES.has(block.signalType))
      ) {
        await this.attributeSubject({
          event,
          block,
          blockId,
          segments: args.segments,
          authorUserId: args.authorUserId,
          authorPersonId: args.authorPersonId ?? null,
          authorEmail: args.authorEmail ?? null,
        }).catch((err) => {
          this.logger.warn(
            {
              blockId,
              err: err instanceof Error ? err.message : String(err),
            },
            'block-ingest: subject-атрибуция не удалась — пропуск',
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

  /**
   * Фаза 1.2 — детерминированная атрибуция автора блока-рассуждения как
   * `IdeaBlockEntity.role='subject'` (БЕЗ LLM, prompt-cache сохранён).
   *
   * Источник identity:
   *   - per-adapter (Ф1): authorPersonId (chatbox/dump) / authorEmail (email) /
   *     authorUserId (tracker/free_note) — из `tryGetActorIdentity`.
   *   - meeting: сегмент, перекрывающий evidence по времени, даёт
   *     `speakerParticipantId` (+ `speakers[0]` как fallback-имя).
   *
   * `resolveSubjectEntityId` лениво создаёт person-Entity и возвращает его id.
   * upsert по композитному PK `@@id([blockId,entityId])` — апгрейд связи
   * `mentioned→subject` односторонний (коллизия «автор уже упомянут»).
   *
   * Kill-switch — AdminSetting `knowledge.subjectAttributionEnabled`
   * (code-fallback `true`). При `false` шаг пропускается (регресс-страховка).
   */
  private async attributeSubject(args: {
    event: RawEvent;
    block: ExtractedBlock;
    blockId: string;
    segments: Segment[];
    authorUserId: string | null;
    authorPersonId?: string | null;
    authorEmail?: string | null;
  }): Promise<void> {
    const enabled = await this.cfg.getDynamic<boolean>(
      'knowledge.subjectAttributionEnabled',
      undefined,
      true,
    );
    if (!enabled) return;

    // Встреча: ищем сегмент, чей таймкод-диапазон покрывает evidenceStartMs.
    // Для text-сегментов (endMs=0) это условие ложно → identity берётся из
    // authorUserId. Берём speakers[0] как fallback-имя спикера.
    const seg =
      args.segments.find(
        (s) =>
          s.endMs > 0 &&
          args.block.evidenceStartMs >= s.startMs &&
          args.block.evidenceStartMs <= s.endMs,
      ) ?? null;

    // chatbox per-message: сегмент несёт детерминированного автора
    // (string=сотрудник, null=клиент → subject НЕ пишем). Для встреч/одно-
    // авторных источников поле отсутствует → прежнее поведение.
    const segHasAuthor =
      seg !== null &&
      Object.prototype.hasOwnProperty.call(seg, 'authorPersonId');

    let subjectEntityId: string | null;
    let via: string;
    if (segHasAuthor) {
      const segAuthor = seg?.authorPersonId ?? null;
      subjectEntityId = segAuthor
        ? await this.entities.resolveSubjectEntityId(args.event.tenantId, {
            authorPersonId: segAuthor,
            authorEmail: null,
            speakerParticipantId: null,
            speakerName: null,
            authorUserId: null,
          })
        : null; // клиентская реплика — subject-менеджер не пишем
      // Ф1 — метрика доли субъект-атрибуций по источнику identity. Считается
      // и при null-результате (via='none'), но ПОСЛЕ kill-switch.
      via = subjectEntityId ? 'personId' : 'none';
    } else {
      const speakerParticipantId = seg?.speakerParticipantId ?? null;
      const speakerName = seg?.speakers?.[0] ?? null;
      subjectEntityId = await this.entities.resolveSubjectEntityId(
        args.event.tenantId,
        {
          authorPersonId: args.authorPersonId ?? null,
          authorEmail: args.authorEmail ?? null,
          speakerParticipantId,
          speakerName,
          authorUserId: args.authorUserId,
        },
      );
      // via — по приоритету фактически присутствующего источника identity.
      via = subjectEntityId
        ? args.authorPersonId
          ? 'personId'
          : args.authorUserId
            ? 'userId'
            : args.authorEmail
              ? 'email'
              : speakerParticipantId
                ? 'participant'
                : speakerName
                  ? 'name'
                  : 'none'
        : 'none';
    }
    this.metrics.incSubjectAttribution({ via });

    if (!subjectEntityId) return;

    await this.prisma.ideaBlockEntity.upsert({
      where: {
        blockId_entityId: { blockId: args.blockId, entityId: subjectEntityId },
      },
      create: {
        blockId: args.blockId,
        entityId: subjectEntityId,
        mentionContext: 'author',
        role: 'subject',
      },
      update: { role: 'subject' },
    });

    this.logger.debug(
      {
        blockId: args.blockId,
        entityId: subjectEntityId,
        signalType: args.block.signalType,
        via,
      },
      'block-ingest: автор помечен role=subject',
    );
  }

  /**
   * ТЗ-D (2026-06-05) — детерминированная атрибуция АВТОРА обещания в
   * IdeaBlock.commitmentAuthorPersonId. Зеркало attributeSubject, но пишет
   * скаляр-поле (не IdeaBlockEntity) и резолвит Person.id (resolveSubjectPersonId).
   * Источник identity: сегмент встречи (speakerParticipantId) либо authorUserId
   * (текстовые каналы). БЕЗ LLM — prompt-cache сохранён.
   * Kill-switch — AdminSetting knowledge.commitmentAuthorAttributionEnabled
   * (code-fallback true).
   */
  private async attributeCommitmentAuthor(args: {
    event: RawEvent;
    block: ExtractedBlock;
    blockId: string;
    segments: Segment[];
    authorUserId: string | null;
    authorPersonId?: string | null;
    authorEmail?: string | null;
  }): Promise<void> {
    const enabled = await this.cfg.getDynamic<boolean>(
      'knowledge.commitmentAuthorAttributionEnabled',
      undefined,
      true,
    );
    if (!enabled) return;

    const seg =
      args.segments.find(
        (s) =>
          s.endMs > 0 &&
          args.block.evidenceStartMs >= s.startMs &&
          args.block.evidenceStartMs <= s.endMs,
      ) ?? null;

    // chatbox per-message: сегмент несёт детерминированного автора (string=
    // сотрудник, null=клиент → обещание клиента менеджеру НЕ приписываем).
    // Для встреч/одно-авторных источников поле отсутствует → прежний путь.
    const segHasAuthor =
      seg !== null &&
      Object.prototype.hasOwnProperty.call(seg, 'authorPersonId');

    let authorPersonId: string | null;
    let via: string;
    if (segHasAuthor) {
      const segAuthor = seg?.authorPersonId ?? null;
      authorPersonId = segAuthor
        ? await this.entities.resolveSubjectPersonId(args.event.tenantId, {
            speakerParticipantId: null,
            speakerName: null,
            authorUserId: null,
            authorPersonId: segAuthor,
            authorEmail: null,
          })
        : null;
      via = 'personId';
    } else {
      const speakerParticipantId = seg?.speakerParticipantId ?? null;
      const speakerName = seg?.speakers?.[0] ?? null;
      authorPersonId = await this.entities.resolveSubjectPersonId(
        args.event.tenantId,
        {
          speakerParticipantId,
          speakerName,
          authorUserId: args.authorUserId,
          authorPersonId: args.authorPersonId ?? null,
          authorEmail: args.authorEmail ?? null,
        },
      );
      via = speakerParticipantId
        ? 'speakerParticipantId'
        : args.authorUserId
          ? 'authorUserId'
          : 'speakerName';
    }
    if (!authorPersonId) return;

    await this.prisma.ideaBlock.update({
      where: { id: args.blockId },
      data: { commitmentAuthorPersonId: authorPersonId },
    });

    this.logger.debug(
      {
        blockId: args.blockId,
        authorPersonId,
        via,
      },
      'block-ingest: автор обещания проставлен (commitmentAuthorPersonId)',
    );
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

  /**
   * SBA β-8.2 — парсинг `commitmentDueDateGuess` из LLM. Принимаем строго
   * YYYY-MM-DD; всё прочее (null/пусто/мусор) → null, чтобы Хранитель
   * обещаний поставил fallback (createdAt + 5 рабочих дней).
   */
  private parseGuessedDueDate(input: string | null | undefined): Date | null {
    if (typeof input !== 'string') return null;
    const trimmed = input.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
    const d = new Date(`${trimmed}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  /**
   * KC-Temporal W1.4 — собирает массив `PropertySpan` для записи в
   * `IdeaBlock.propertySpans`. Сейчас — только из
   * `mentionedEntities[*].sourceSpan` (опциональное LLM-поле).
   *
   * Формат записи (см. ТЗ §W1.4):
   *   { field: 'mentionedEntity', refId?, evidenceId, startMs, endMs }
   *
   * `refId` для entity сейчас null — entity ещё не разрешена (linkEntity
   * происходит вне транзакции). Это допустимо: UI смотрит spans по
   * evidenceId + startMs/endMs (прыжок плеера); resolved-entity отдельно.
   *
   * Возвращает null, если в блоке нет mentionedEntities; пустой массив —
   * если ни у одной mention LLM не вернул sourceSpan (caller сам решит,
   * писать ли в БД).
   */
  private buildPropertySpans(
    block: ExtractedBlock,
    evidenceId: string,
  ): PropertySpan[] | null {
    if (!Array.isArray(block.mentionedEntities) || block.mentionedEntities.length === 0) {
      return null;
    }
    const spans: PropertySpan[] = [];
    for (const mention of block.mentionedEntities) {
      const sourceSpan = (mention as ExtractedEntityMention & {
        sourceSpan?: { startMs?: number; endMs?: number };
      }).sourceSpan;
      if (!sourceSpan) continue;
      const { startMs, endMs } = sourceSpan;
      if (
        typeof startMs !== 'number' ||
        typeof endMs !== 'number' ||
        !Number.isFinite(startMs) ||
        !Number.isFinite(endMs) ||
        startMs < 0 ||
        endMs < startMs
      ) {
        continue;
      }
      spans.push({
        field: 'mentionedEntity',
        evidenceId,
        startMs: Math.floor(startMs),
        endMs: Math.floor(endMs),
      });
    }
    return spans;
  }

  /**
   * SBA β-8.2 — попытка сопоставить `commitmentRecipientNameGuess` с
   * конкретным Person в той же Org через простой нечёткий поиск:
   *   1. exact match по полному name (case-insensitive).
   *   2. iLIKE по первому слову guess'а (имя «Маша» → Person.name iLIKE 'Маша%').
   *   3. iLIKE подстрокой если предыдущий шаг ничего не дал.
   * Множественные совпадения → пропускаем (неоднозначно, лучше пусто).
   */
  private async linkCommitmentRecipient(args: {
    tenantId: string;
    blockId: string;
    nameGuess: string;
  }): Promise<void> {
    const guess = args.nameGuess.trim();
    if (guess.length < 2 || guess.length > 100) return;

    // 1. Exact match.
    let candidates = await this.prisma.person.findMany({
      where: {
        tenantId: args.tenantId,
        deletedAt: null,
        name: { equals: guess, mode: 'insensitive' },
      },
      select: { id: true },
      take: 2,
    });
    if (candidates.length === 0) {
      // 2. Prefix по первому слову.
      const firstWord = guess.split(/\s+/)[0];
      if (firstWord && firstWord.length >= 2) {
        candidates = await this.prisma.person.findMany({
          where: {
            tenantId: args.tenantId,
            deletedAt: null,
            name: { startsWith: firstWord, mode: 'insensitive' },
          },
          select: { id: true },
          take: 2,
        });
      }
    }
    if (candidates.length === 0) {
      // 3. Contains.
      candidates = await this.prisma.person.findMany({
        where: {
          tenantId: args.tenantId,
          deletedAt: null,
          name: { contains: guess, mode: 'insensitive' },
        },
        select: { id: true },
        take: 2,
      });
    }
    if (candidates.length !== 1) {
      // Либо ноль (никого), либо ≥2 (неоднозначно) — оставляем null.
      return;
    }
    const personId = candidates[0]?.id;
    if (!personId) return;
    await this.prisma.ideaBlock.update({
      where: { id: args.blockId },
      data: { commitmentRecipientPersonId: personId },
    });
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

  /**
   * ТЗ-4 Ф4 — документная привязка влияет на граф. Для RawEvent doc-источника
   * (`sourceExternalId='doc:<id>'`) применяет явную привязку, заданную человеком
   * при загрузке документа, ПОСЛЕ создания всех блоков:
   *   - `attachedRoleId` → перебивает LLM-роль: всем блокам документа
   *     `roleId = attachedRoleId`, `roleRelevant = true` (updateMany).
   *   - `attachedThemeId` → связывает все блоки документа с темой графа
   *     (ThemeIdeaBlock с weight=0.8; чуть ниже дефолта 1.0 — явная привязка
   *     ценна, но слабее «органической» кластеризации).
   *
   * Идемпотентно: `updateMany` повторяемо, `createMany({ skipDuplicates })`
   * не дублирует строки при ретрае (PK `[themeId, blockId]`). Применяется
   * ДАЖЕ когда LLM не разрешил ни одной роли — явная атрибуция действует
   * независимо от извлечения. НЕ трогает алгоритмы кластеризации/извлечения.
   */
  private async applyDocumentAttribution(
    event: RawEvent,
    payload: unknown,
    blockIds: string[],
  ): Promise<void> {
    if (!event.sourceExternalId?.startsWith('doc:') || blockIds.length === 0) {
      return;
    }
    const p = (payload ?? {}) as {
      attachedRoleId?: string | null;
      attachedThemeId?: string | null;
    };
    if (p.attachedRoleId) {
      await this.prisma.ideaBlock.updateMany({
        where: { id: { in: blockIds }, tenantId: event.tenantId },
        data: { roleId: p.attachedRoleId, roleRelevant: true },
      });
    }
    if (p.attachedThemeId) {
      const themeId = p.attachedThemeId;
      await this.prisma.themeIdeaBlock.createMany({
        data: blockIds.map((blockId) => ({
          themeId,
          blockId,
          weight: new Prisma.Decimal('0.8'),
        })),
        skipDuplicates: true,
      });
    }
  }

  private parseDecidedAt(input: string | null | undefined): Date | null {
    if (!input) return null;
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /**
   * Безопасный warn для падений группы Б — мы не валим весь job из-за
   * одной кривой сущности, но детально логируем для аудита.
   *
   * МТЗ Ф5: КЛАССИФИЦИРУЕМ причину (`age_unavailable`/`idempotent_skip`/
   * `validation_error`/`other`), инкрементим метрику `kc_typed_entity_failed_total`
   * и ВОЗВРАЩАЕМ reason — вызывающий аккумулирует системный отказ графа,
   * чтобы НЕ помечать RawEvent='ingested' (тихая потеря → наблюдаемый failed
   * + авто-ретрай BullMQ после восстановления AGE). idempotent_skip /
   * validation_error / other — НЕ системный отказ, ingested остаётся.
   */
  private warnTypedFail(
    type: string,
    name: string,
    err: unknown,
  ): TypedFailReason {
    const reason = classifyTypedFailReason(err);
    // Нормализуем type-метку («decision (fallback)» → «decision»).
    const metricType = type.split(' ')[0] ?? type;
    this.metrics.incTypedEntityFailed({ type: metricType, reason });
    this.logger.warn(
      {
        type,
        name,
        reason,
        err: err instanceof Error ? err.message : String(err),
      },
      reason === 'age_unavailable'
        ? 'block-ingest: системный отказ графа AGE при записи сущности группы Б — RawEvent НЕ будет помечен ingested (failed + ретрай)'
        : 'block-ingest: типизированная сущность группы Б не сохранилась — пропуск',
    );
    return reason;
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
