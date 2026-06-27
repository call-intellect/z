import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
  Optional,
} from '@nestjs/common';
import {
  type Entity,
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
import { CORE_QUEUE_NAMES, type RawEventJobData } from '../../core-queue/queues';
import { WorkerOrgGate } from '../../core-queue/worker-org-gate';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { isEntityUnattributed } from '../../probe/probe-reason-policy';
import { ProbeService } from '../../probe/probe.service';
import { S3Service } from '../../recordings/s3.service';
import { ENTITY_TYPE_VALUES, SIGNAL_TYPE_VALUES } from '../prompts/block-ingest.prompt';
import { AxisClassifierService } from '../services/axis-classifier.service';
import { BlockAccessDeriverService } from '../services/block-access-deriver.service';
import {
  BlockExtractionService,
  type ExtractedBlock,
  type ExtractedEntityMention,
} from '../services/block-extraction.service';
import { ChunkContextService } from '../services/chunk-context.service';
import { KnowledgeEmbeddingService } from '../services/embedding.service';
import { isJunkEntityName } from '../services/entity-name-quality';
import { EntityResolutionService } from '../services/entity-resolution.service';
import { SegmentBuilderService, type Segment } from '../services/segment-builder.service';

export const TRACKER_ECHO_SIGNALS = new Set<string>([
  'task_created',
  'task_status_changed',
  'task_blocked',
  'task_completed',
  'task_overdue',
  'task_reassigned',
  'task_comment',
  'task_mention',
]);

const REASONING_SUBJECT_SIGNAL_TYPES: ReadonlySet<string> = new Set([
  'reasoning',
  'rationale',
  'decision_basis',
  'expertise',
  'experience',
  'competence',
  'methodology_step',
]);

export interface PropertySpan {
  field: 'name' | 'criticalQuestion' | 'trustedAnswer' | 'mentionedEntity';
  refId?: string;
  evidenceId: string;
  startMs: number;
  endMs: number;
}

export type TypedFailReason = 'age_unavailable' | 'idempotent_skip' | 'validation_error' | 'other';

export function classifyTypedFailReason(err: unknown): TypedFailReason {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return 'idempotent_skip';
  }

  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();

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

  if (message.includes('p2002') || message.includes('unique constraint')) {
    return 'idempotent_skip';
  }

  const errName = err instanceof Error ? (err.constructor?.name ?? err.name) : '';
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

export type IngestFailureKind = 'llm_extraction' | 'age_unavailable';

export function buildIngestFailureMessage(kind: IngestFailureKind): string {
  if (kind === 'llm_extraction') {
    return (
      'block-ingest: все окна LLM-извлечения провалились (taskType block-ingest) — ' +
      'RawEvent НЕ ingested, job уходит в failed для ретрая после восстановления LLM-провайдеров'
    );
  }
  return (
    'block-ingest: системный отказ графа AGE (cypher не резолвится) — ' +
    'RawEvent НЕ помечен ingested, job уходит в failed для ретрая ' +
    'после восстановления AGE'
  );
}

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
    @Inject(BlockAccessDeriverService)
    private readonly blockAccessDeriver: BlockAccessDeriverService,
    // Probe Ф6 (2026-06-17) — атрибуционный вопрос «к чему относится новая
    // сущность». @Optional: ProbeModule глобальный (как у specialist-3-4),
    // но Optional страхует юнит-тесты/конструирование без probe.
    @Optional()
    @Inject(ProbeService)
    private readonly probeService?: ProbeService,
    @Optional()
    @Inject(ChunkContextService)
    private readonly chunkContext?: ChunkContextService,
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
        this.logger.error(`onJobFailed: ${e instanceof Error ? e.message : String(e)}`);
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

    await this.gate.checkOrThrow(event.tenantId, 'block-ingest');

    try {
      const payload = await this.loadPayload(event);
      const segments = this.segments.buildSegments(payload);
      const authorIdentity = this.tryGetActorIdentity(payload);
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
        meetingDateIso: event.occurredAt.toISOString(),
        meetingType: this.tryGetMeetingType(payload),
        participants: this.tryGetParticipantNames(payload),
        segments,
        dataClass: event.dataClass,
      });
      const signalHint = this.tryGetSignalTypeHint(payload);
      const isReportEvent = event.sourceType === 'meeting_report';
      const blocksInOrder = this.applySignalTypeHint(
        extraction.blocksInOrder,
        signalHint,
        payload,
        isReportEvent,
      );
      const { typed } = extraction;
      this.logger.debug(
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

      const contextHeader = this.chunkContext
        ? await this.chunkContext
            .buildContextHeader({
              tenantId: event.tenantId,
              meetingTitle,
              meetingType: this.tryGetMeetingType(payload),
              meetingDateIso: event.occurredAt.toISOString(),
              participants: this.tryGetParticipantNames(payload),
            })
            .catch(() => '')
        : '';

      const embeddings =
        blocksInOrder.length > 0
          ? await this.embeddings.embedBlocks(blocksInOrder, contextHeader)
          : [];

      const indexToBlockId = new Map<number, string>();
      const blockIds: string[] = [];
      let persistFailures = 0;
      const decisionBlockIds = new Set<string>();
      const ideaEmbeddingByBlockId = new Map<string, number[] | null>();

      for (let i = 0; i < blocksInOrder.length; i++) {
        const block = blocksInOrder[i] as ExtractedBlock;
        const vector = embeddings[i];

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
        } else {
          persistFailures += 1;
        }
      }

      const summaryBlockId = await this.maybePersistMeetingSummary({
        event,
        payload,
        contextHeader,
      }).catch((err) => {
        this.logger.warn(
          { rawEventId, err: err instanceof Error ? err.message : String(err) },
          'block-ingest: summary-блок «суть встречи» не создан — пропуск',
        );
        return null;
      });
      if (summaryBlockId) blockIds.push(summaryBlockId);

      await this.createStructuralEntityEdges(event.tenantId, blockIds).catch((err) => {
        this.logger.warn(
          { rawEventId, err: err instanceof Error ? err.message : String(err) },
          'block-ingest: структурные shares_entity не построены — пропуск',
        );
      });

      await this.applyDocumentAttribution(event, payload, blockIds).catch((err) => {
        this.logger.warn(
          { rawEventId, err: err instanceof Error ? err.message : String(err) },
          'block-ingest: документная привязка (ТЗ-4 Ф4) не удалась — пропуск',
        );
      });

      const llmDecisionBlockIds = new Set<string>();

      let systemFailure = false;
      let failureKind: IngestFailureKind | null = null;

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
          if (this.warnTypedFail('process', proc.name, err) === 'age_unavailable') {
            systemFailure = true;
            failureKind = 'age_unavailable';
          }
        }
      }

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
          if (this.warnTypedFail('regulation', reg.name, err) === 'age_unavailable') {
            systemFailure = true;
            failureKind = 'age_unavailable';
          }
        }
      }

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
          if (this.warnTypedFail('policy', pol.name, err) === 'age_unavailable') {
            systemFailure = true;
            failureKind = 'age_unavailable';
          }
        }
      }

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
          if (this.warnTypedFail('tool', tool.name, err) === 'age_unavailable') {
            systemFailure = true;
            failureKind = 'age_unavailable';
          }
        }
      }

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
          if (this.warnTypedFail('metric', metric.name, err) === 'age_unavailable') {
            systemFailure = true;
            failureKind = 'age_unavailable';
          }
        }
      }

      for (const dec of typed.decisions) {
        try {
          const sourceBlockId =
            dec.sourceBlockIndex != null
              ? (indexToBlockId.get(dec.sourceBlockIndex) ?? null)
              : null;

          const decidedAt = this.parseDecidedAt(dec.decidedAt) ?? event.occurredAt;

          let decidedByPersonId: string | undefined;
          if (dec.decidedByPersonHint) {
            const personId = await this.entities
              .resolvePersonByHint(event.tenantId, dec.decidedByPersonHint, dec.text)
              .catch(() => null);
            if (personId) decidedByPersonId = personId;
          }

          const decisionData: Record<string, unknown> = {
            text: dec.text,
            decidedAt,
            rationale: dec.rationale ?? null,
            sourceMeetingId: event.sourceType === 'meeting' ? event.sourceExternalId : null,
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
          if (this.warnTypedFail('decision', dec.text.slice(0, 80), err) === 'age_unavailable') {
            systemFailure = true;
            failureKind = 'age_unavailable';
          }
        }
      }

      // Fallback Decision-create для блоков signalType='decision', по которым
      // LLM не вернул отдельную запись в decisions[]. Idempotent по
      // sourceIdeaBlockId (upsertEntity сам проверяет существование).
      //
      // Б19 [K14] — fallback подчиняется тому же гейту качества, что и основной
      // путь группы Б: typed-сущности с confidence < typedEntityMinConfidence
      // отбрасываются ещё в BlockExtractionService, но fallback идёт по
      // signalType блока (минуя тот фильтр) — поэтому проверяем порог здесь, иначе
      // в граф попадали бы «решения» ниже порога доверия.
      const typedMinConfidence = this.cfg.extraction.typedEntityMinConfidence;
      for (const blockId of decisionBlockIds) {
        if (llmDecisionBlockIds.has(blockId)) continue;
        const block = blocksInOrder.find((_, idx) => indexToBlockId.get(idx) === blockId);
        if (!block) continue;
        // Б19 — гейт качества: ниже порога доверия решение не материализуем.
        if (block.confidence < typedMinConfidence) continue;
        try {
          const res = await this.graph.upsertEntity({
            tenantId: event.tenantId,
            type: 'decision',
            data: {
              text: block.trustedAnswer,
              decidedAt: event.occurredAt,
              sourceIdeaBlockId: blockId,
              sourceMeetingId: event.sourceType === 'meeting' ? event.sourceExternalId : null,
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
            this.warnTypedFail('decision (fallback)', block.trustedAnswer.slice(0, 80), err) ===
            'age_unavailable'
          ) {
            systemFailure = true;
            failureKind = 'age_unavailable';
          }
        }
      }

      if (this.cfg.knowledgeCore.ideaDirectPathEnabled && ideaEmbeddingByBlockId.size > 0) {
        const ideaCandidateIds = [...ideaEmbeddingByBlockId.keys()];
        if (ideaCandidateIds.length > 0) {
          const rows = await this.prisma.ideaBlock.findMany({
            where: { id: { in: ideaCandidateIds } },
            select: { id: true, tenantId: true, trustedAnswer: true, confidence: true, dataClass: true, createdAt: true },
          });
          for (const row of rows) {
            const statement = (row.trustedAnswer ?? '').trim();
            if (!statement) continue; // пустую идею не материализуем

            // Б22 [K4] — детерминированный source-block дедуп ПЕРЕД create
            // (как guard в Specialist 3.6). При reprocess-suffix RawEvent тот же
            // sourceBlockId уже материализован прошлым прогоном → НЕ создаём дубль.
            // Терминальные статусы (rejected/archived) исключаем — если идею
            // отклонили, не воскрешаем её повторным ingest'ом.
            const existing = await this.prisma.idea.findFirst({
              where: {
                tenantId: row.tenantId,
                sourceBlockIds: { has: row.id },
                status: { notIn: ['rejected', 'archived'] },
              },
              select: { id: true },
            });
            if (existing) continue;

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
              this.metrics.incExtractionEntity({ type: 'idea' });
              const emb = ideaEmbeddingByBlockId.get(row.id);
              if (emb && emb.length > 0) {
                try {
                  const vecStr = `[${emb.join(',')}]`;
                  await this.prisma.$executeRawUnsafe(
                    `UPDATE "ideas" SET "embedding" = $1::vector WHERE "id" = $2`,
                    vecStr,
                    idea.id,
                  );
                } catch {}
              }
            } catch (err) {
              // P2002 (гонка concurrency=2 / параллельный reprocess) — идемпотентный
              // skip: идею создал параллельный путь, дубль не нужен.
              if (
                err instanceof Prisma.PrismaClientKnownRequestError &&
                err.code === 'P2002'
              ) {
                continue;
              }
              this.logger.warn(
                { blockId: row.id, err: err instanceof Error ? err.message : String(err) },
                'block-ingest: idea direct-path create упал — пропуск блока',
              );
            }
          }
          // Б37 [K4] — НЕ создаём CurationItem прямо из direct-path (нет
          // CurationService в воркере и его инъекция тянет circular-dep).
          // Инвариант выровнен в Specialist 3.6: его dispatch ВСЕГДА приходит на
          // этот idea-блок (canonical-переход), видит уже материализованную idea
          // (guard `alreadyMaterialized`), обогащает её И идемпотентно прогоняет
          // тот же triageProposed-путь, если CurationItem ещё нет — так direct-path
          // и Specialist-3.6-идея сходятся к одному набору полей/видимости.
          // Б9 [K10] — enqueueIdeaClusterer убран: очередь core.idea-clusterer
          // удалена (без consumer'а), кластеризация идёт по @Cron (IdeaClustererCron).
        }
      }

      if (extraction.failedWindows > 0) {
        this.metrics.incCorePartialLoss({
          reason: 'extraction_window_failed',
          count: extraction.failedWindows,
        });
      }
      if (persistFailures > 0) {
        this.metrics.incCorePartialLoss({
          reason: 'persist_null',
          count: persistFailures,
        });
      }
      if (extraction.failedWindows > 0 && blockIds.length === 0) {
        this.logger.error(
          { rawEventId, failedWindows: extraction.failedWindows, failureKind: 'llm_extraction' },
          'block-ingest: все окна LLM-извлечения провалились, 0 блоков — RawEvent НЕ ingested (failed для ретрая после восстановления LLM-провайдеров)',
        );
        systemFailure = true;
        if (failureKind === null) failureKind = 'llm_extraction';
      }

      if (systemFailure) {
        throw new Error(buildIngestFailureMessage(failureKind ?? 'age_unavailable'));
      }

      await this.prisma.rawEvent.update({
        where: { id: rawEventId },
        data: {
          processingStatus: 'ingested',
          processedAt: new Date(),
          processingError: null,
        },
      });

      for (const blockId of blockIds) {
        await this.coreQueue.enqueueBlockDistill(blockId).catch((err) => {
          this.logger.warn(
            { blockId, err: err instanceof Error ? err.message : String(err) },
            'block-ingest: enqueueBlockDistill упал — дистилляция произойдёт позже',
          );
        });
      }

      for (let i = 0; i < blocksInOrder.length; i++) {
        const block = blocksInOrder[i] as ExtractedBlock;
        const blockId = indexToBlockId.get(i);
        if (!blockId) continue;
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

  private async loadPayload(event: RawEvent): Promise<unknown> {
    if (event.payloadStorage === 's3') {
      if (!event.payloadS3Key) {
        throw new Error(`RawEvent ${event.id}: payloadStorage=s3, но payloadS3Key пустой`);
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

  private tryGetMeetingType(payload: unknown): string | undefined {
    if (typeof payload !== 'object' || payload === null) return undefined;
    const p = payload as { type?: unknown; meetingType?: unknown };
    const t = p.type;
    if (typeof t === 'string' && t.length > 0) return t;
    const mt = p.meetingType;
    if (typeof mt === 'string' && mt.length > 0) return mt;
    return undefined;
  }

  private tryGetParticipantNames(payload: unknown): string[] | undefined {
    if (typeof payload !== 'object' || payload === null) return undefined;
    const parts = (payload as { participants?: unknown }).participants;
    if (!Array.isArray(parts)) return undefined;
    const names: string[] = [];
    for (const p of parts) {
      if (p === null || typeof p !== 'object') continue;
      const name = (p as { displayName?: unknown }).displayName;
      if (typeof name === 'string' && name.trim().length > 0) {
        names.push(name.trim());
      }
      if (names.length >= 12) break;
    }
    return names.length > 0 ? names : undefined;
  }

  private tryGetAuthorUserId(payload: unknown): string | null {
    if (typeof payload !== 'object' || payload === null) return null;
    const v = (payload as { userId?: unknown }).userId;
    return typeof v === 'string' && v.trim().length > 0 ? v : null;
  }

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

    const t = p['transcript'];
    const turns = t && typeof t === 'object' ? (t as { turns?: unknown }).turns : undefined;
    const hasPerMessageAuthors =
      Array.isArray(turns) &&
      turns.some(
        (tn) =>
          tn !== null &&
          typeof tn === 'object' &&
          'authorPersonId' in (tn as Record<string, unknown>),
      );

    const actor = p['actor'];
    if (actor && typeof actor === 'object') {
      const uid = (actor as { userId?: unknown }).userId;
      if (typeof uid === 'string' && uid.trim().length > 0) {
        return { ...empty, authorUserId: uid };
      }
    }
    const resp = p['responsible'];
    if (resp && typeof resp === 'object' && !hasPerMessageAuthors) {
      const pid = (resp as { personId?: unknown }).personId;
      if (typeof pid === 'string' && pid.trim().length > 0) {
        return { ...empty, authorPersonId: pid };
      }
    }
    const uploaderId = p['uploaderId'];
    if (typeof uploaderId === 'string' && uploaderId.trim().length > 0) {
      return { ...empty, authorPersonId: uploaderId };
    }
    const userId = this.tryGetAuthorUserId(payload);
    if (userId) return { ...empty, authorUserId: userId };
    const from = p['from'];
    if (from && typeof from === 'object') {
      const addr = (from as { address?: unknown }).address;
      if (typeof addr === 'string' && addr.includes('@')) {
        return { ...empty, authorEmail: addr };
      }
    }
    return empty;
  }

  private tryGetSignalTypeHint(payload: unknown): SignalType | null {
    if (typeof payload !== 'object' || payload === null) return null;
    const v = (payload as { signalTypeHint?: unknown }).signalTypeHint;
    if (typeof v !== 'string') return null;
    if (!(SIGNAL_TYPE_VALUES as readonly string[]).includes(v)) return null;
    return v as SignalType;
  }

  private applySignalTypeHint(
    blocks: ExtractedBlock[],
    hint: SignalType | null,
    payload: unknown,
    isReportEvent = false,
  ): ExtractedBlock[] {
    if (!hint) return blocks;
    if (blocks.length === 0) {
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

  private buildSyntheticBlock(hint: SignalType, payload: unknown): ExtractedBlock | null {
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

  private tryGetReportSummaryMarkdown(payload: unknown): string | null {
    if (typeof payload !== 'object' || payload === null) return null;
    const p = payload as { kind?: unknown; reportSummaryMarkdown?: unknown };
    if (p.kind !== 'meeting_report') return null;
    const md = typeof p.reportSummaryMarkdown === 'string' ? p.reportSummaryMarkdown.trim() : '';
    return md.length > 0 ? md : null;
  }

  private async maybePersistMeetingSummary(args: {
    event: RawEvent;
    payload: unknown;
    contextHeader: string;
  }): Promise<string | null> {
    const { event, payload, contextHeader } = args;
    if (event.sourceType !== 'meeting_report') return null;
    const summaryMd = this.tryGetReportSummaryMarkdown(payload);
    if (!summaryMd) return null;

    const meetingTitle = this.tryGetMeetingTitle(payload);
    const answer = summaryMd.slice(0, 4000);
    const summaryBlock: ExtractedBlock = {
      name: (meetingTitle ? `Суть встречи: ${meetingTitle}` : 'Суть встречи').slice(0, 200),
      criticalQuestion: 'О чём была встреча и что главное?',
      trustedAnswer: answer,
      signalType: 'fact',
      tags: [],
      confidence: 0.9,
      evidenceQuote: answer.slice(0, 500),
      evidenceStartMs: 0,
      evidenceEndMs: 0,
      mentionedEntities: [],
      role_relevant: false,
    };
    const [vector] = await this.embeddings.embedBlocks([summaryBlock], contextHeader);
    return this.persistBlock({
      event,
      block: summaryBlock,
      embedding: vector ?? null,
      roleRelevant: false,
      roleId: null,
      segments: [],
      authorUserId: null,
      isMeetingSummary: true,
    });
  }

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
    isMeetingSummary?: boolean;
  }): Promise<string | null> {
    const { event, block, embedding, roleRelevant, roleId } = args;
    if (!block.evidenceQuote || block.evidenceQuote.trim().length === 0) {
      this.metrics.incBlockWithoutEvidence({ reason: 'empty_quote' });
      this.logger.warn(
        { rawEventId: event.id, blockName: block.name },
        'block-ingest: блок без evidence-цитаты (провенанс-инвариант) — отброшен',
      );
      return null;
    }
    try {
      const isCommitment = block.signalType === 'commitment';
      const commitmentDueDate = isCommitment
        ? this.parseGuessedDueDate(block.commitmentDueDateGuess)
        : null;

      const bitemporalEnabled = this.cfg.bitemporal.enabled;
      const validFromValue: Date | null = bitemporalEnabled ? event.occurredAt : null;

      const isReport = event.sourceType === 'meeting_report';
      const applyReportCap = isReport && args.isMeetingSummary !== true;
      const reportConfidenceCap = applyReportCap
        ? await this.cfg.getDynamic<number>('knowledge.reportBlockConfidenceCap', undefined, 0.6)
        : 1;
      const effectiveConfidence = applyReportCap
        ? Math.min(block.confidence, reportConfidenceCap)
        : block.confidence;

      const evidenceAuthor = await this.resolveEvidenceAuthor(args.segments, block, event);

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
            ...(applyReportCap ? { dynamicScore: new Prisma.Decimal('0.7') } : {}),
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
            tenantId: event.tenantId,
            blockId: ideaBlock.id,
            rawEventId: event.id,
            sourceType: event.sourceType,
            sourceTimestamp: event.occurredAt,
            quote: block.evidenceQuote,
            startMs: block.evidenceStartMs,
            endMs: block.evidenceEndMs,
            sourceMessageExternalId: this.resolveEvidenceMessageId(block, args.segments),
            authorPersonId: evidenceAuthor.authorPersonId,
            authorLabel: evidenceAuthor.authorLabel,
          },
        });
        const propertySpansValue = this.buildPropertySpans(block, evidence.id);
        if (propertySpansValue !== null && propertySpansValue.length > 0) {
          await tx.ideaBlock.update({
            where: { id_tenantId: { id: ideaBlock.id, tenantId: event.tenantId } },
            data: {
              propertySpans: propertySpansValue as unknown as Prisma.InputJsonValue,
            },
          });
        }
        return ideaBlock.id;
      });

      if (!TRACKER_ECHO_SIGNALS.has(block.signalType)) {
        for (const mention of block.mentionedEntities) {
          await this.linkEntity({
            tenantId: event.tenantId,
            blockId,
            mention,
            event,
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
      }

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

      if (
        blockId &&
        (args.subjectAllTypes === true || REASONING_SUBJECT_SIGNAL_TYPES.has(block.signalType))
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

    const seg =
      args.segments.find(
        (s) =>
          s.endMs > 0 &&
          args.block.evidenceStartMs >= s.startMs &&
          args.block.evidenceStartMs <= s.endMs,
      ) ?? null;

    const segHasAuthor =
      seg !== null && Object.prototype.hasOwnProperty.call(seg, 'authorPersonId');

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
        : null;
      via = subjectEntityId ? 'personId' : 'none';
    } else {
      const speakerParticipantId = seg?.speakerParticipantId ?? null;
      const speakerName = seg?.speakers?.[0] ?? null;
      subjectEntityId = await this.entities.resolveSubjectEntityId(args.event.tenantId, {
        authorPersonId: args.authorPersonId ?? null,
        authorEmail: args.authorEmail ?? null,
        speakerParticipantId,
        speakerName,
        authorUserId: args.authorUserId,
      });
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
        blockId_entityId_tenantId: {
          blockId: args.blockId,
          entityId: subjectEntityId,
          tenantId: args.event.tenantId,
        },
      },
      create: {
        tenantId: args.event.tenantId,
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

    const segHasAuthor =
      seg !== null && Object.prototype.hasOwnProperty.call(seg, 'authorPersonId');

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
      authorPersonId = await this.entities.resolveSubjectPersonId(args.event.tenantId, {
        speakerParticipantId,
        speakerName,
        authorUserId: args.authorUserId,
        authorPersonId: args.authorPersonId ?? null,
        authorEmail: args.authorEmail ?? null,
      });
      via = speakerParticipantId
        ? 'speakerParticipantId'
        : args.authorUserId
          ? 'authorUserId'
          : 'speakerName';
    }
    if (!authorPersonId) return;

    await this.prisma.ideaBlock.update({
      where: { id_tenantId: { id: args.blockId, tenantId: args.event.tenantId } },
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
    event?: RawEvent;
  }): Promise<void> {
    if (!ENTITY_TYPE_VALUES.includes(args.mention.type)) {
      return;
    }
    if (isJunkEntityName(args.mention.name)) {
      this.metrics.incExtractionEntity({ type: 'rejected_junk_name' });
      return;
    }
    const { entity, created } = await this.entities.findOrCreateEntity({
      tenantId: args.tenantId,
      type: args.mention.type as EntityType,
      name: args.mention.name,
      metadata: args.mention.metadata,
    });

    // Probe Ф6 (2026-06-17) — атрибуционный вопрос. Только для НОВОЙ значимой
    // сущности (клиент/поставщик) без явной привязки к отделу/клиенту/владельцу.
    // best-effort: ошибка probe НЕ должна валить ingest.
    if (created && args.event) {
      await this.emitAttributionProbe(entity, args.event).catch((err) => {
        this.logger.debug(
          {
            entityId: entity.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'block-ingest: attribution-probe не отправлен (best-effort) — продолжаем',
        );
      });
    }

    try {
      await this.prisma.ideaBlockEntity.create({
        data: {
          tenantId: args.tenantId,
          blockId: args.blockId,
          entityId: entity.id,
          mentionContext: args.mention.mentionContext,
          role: 'mentioned',
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return;
      }
      throw err;
    }
  }

  /**
   * Probe Ф6 (2026-06-17) — отправляет атрибуционный probe для НОВОЙ
   * значимой сущности (клиент/поставщик) без явной привязки к
   * отделу/клиенту/владельцу. reason='attribution.unresolved_at_ingest',
   * окно deferrable (в дайджест). Дедуп/cooldown — штатные внутри
   * `ProbeService.suggest` (content-hash + Ф4 семантика).
   *
   * Получатели: владелец встречи-источника (если sourceType='meeting'),
   * иначе владелец/админы Org. Нет ни одного → эмиссию пропускаем.
   */
  private async emitAttributionProbe(
    entity: Entity,
    event: RawEvent,
  ): Promise<void> {
    if (!this.probeService) return;
    // Чистая проверка типа + metadata: только customer/vendor без привязки.
    if (!isEntityUnattributed({ type: entity.type, metadata: entity.metadata })) {
      return;
    }

    const recipients = await this.resolveAttributionRecipients(entity.tenantId, event);
    if (recipients.length === 0) return; // некому слать — молчим

    const title = entity.canonicalName.slice(0, 100);
    const graceDays = await this.cfg.getDynamic<number>('probe.confirmGraceDays', undefined, 2);
    const notBeforeAt =
      graceDays > 0 ? new Date(Date.now() + graceDays * 24 * 3600 * 1000) : undefined;
    await this.probeService.suggest({
      tenantId: entity.tenantId,
      emittedByService: 'ingest-attribution',
      reason: 'attribution.unresolved_at_ingest',
      payload: {
        message: `К чему отнести «${title}»? Это про какой отдел, проект или клиента?`,
        contextCardId: entity.id,
        contextCardKind: 'entity',
        contextCardTitle: entity.canonicalName,
        objectName: entity.canonicalName,
        dataClass: 'internal',
      },
      recipientCandidates: recipients,
      priorityHint: 0.4,
      dataClass: 'internal',
      notBeforeAt,
    });
    this.logger.debug(
      { entityId: entity.id, type: entity.type, recipients: recipients.length },
      'block-ingest: attribution-probe поставлен (reason=attribution.unresolved_at_ingest)',
    );
  }

  /**
   * Получатели атрибуционного probe: владелец встречи-источника (если событие
   * из встречи), иначе владелец/админы Org. Возвращает уникальный список userId.
   */
  private async resolveAttributionRecipients(
    tenantId: string,
    event: RawEvent,
  ): Promise<string[]> {
    const out: string[] = [];
    if (event.sourceType === 'meeting' && event.sourceExternalId) {
      const meeting = await this.prisma.meeting
        .findFirst({
          where: { id: event.sourceExternalId, tenantId },
          select: { ownerId: true },
        })
        .catch(() => null);
      if (meeting?.ownerId) out.push(meeting.ownerId);
    }
    if (out.length === 0) {
      const admins = await this.prisma.membership.findMany({
        where: { orgId: tenantId, role: { in: ['owner', 'admin'] } },
        select: { userId: true },
        take: 20,
      });
      for (const m of admins) out.push(m.userId);
    }
    return [...new Set(out)];
  }

  private toVectorLiteral(vec: number[]): string {
    return `[${vec.join(',')}]`;
  }

  private parseGuessedDueDate(input: string | null | undefined): Date | null {
    if (typeof input !== 'string') return null;
    const trimmed = input.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
    const d = new Date(`${trimmed}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  private buildPropertySpans(block: ExtractedBlock, evidenceId: string): PropertySpan[] | null {
    if (!Array.isArray(block.mentionedEntities) || block.mentionedEntities.length === 0) {
      return null;
    }
    const spans: PropertySpan[] = [];
    for (const mention of block.mentionedEntities) {
      const sourceSpan = (
        mention as ExtractedEntityMention & {
          sourceSpan?: { startMs?: number; endMs?: number };
        }
      ).sourceSpan;
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

  private resolveEvidenceMessageId(
    block: ExtractedBlock,
    segments: Segment[] | undefined,
  ): string | null {
    if (!Array.isArray(segments) || segments.length === 0) return null;
    const seg =
      segments.find(
        (s) =>
          s.endMs > 0 &&
          block.evidenceStartMs >= s.startMs &&
          block.evidenceStartMs <= s.endMs,
      ) ?? null;
    return seg?.messageExternalId ?? null;
  }

  private async resolveEvidenceAuthor(
    segments: Segment[] | undefined,
    block: ExtractedBlock,
    event: RawEvent,
  ): Promise<{ authorPersonId: string | null; authorLabel: string | null }> {
    const empty = { authorPersonId: null, authorLabel: null };
    try {
      if (!Array.isArray(segments) || segments.length === 0) return empty;
      const seg =
        segments.find(
          (s) =>
            s.endMs > 0 &&
            block.evidenceStartMs >= s.startMs &&
            block.evidenceStartMs <= s.endMs,
        ) ?? null;
      if (!seg) return empty;

      const segHasAuthor = Object.prototype.hasOwnProperty.call(seg, 'authorPersonId');
      if (segHasAuthor) {
        const segAuthor = seg.authorPersonId ?? null;
        if (segAuthor) {
          const person = await this.prisma.person.findUnique({
            where: { id: segAuthor },
            select: { name: true },
          });
          return {
            authorPersonId: segAuthor,
            authorLabel: person?.name ?? seg.speakers?.[0] ?? null,
          };
        }
        return {
          authorPersonId: null,
          authorLabel: seg.authorExternalLabel ?? seg.speakers?.[0] ?? 'Клиент',
        };
      }

      const speakerParticipantId = seg.speakerParticipantId ?? null;
      const speakerName = seg.speakers?.[0] ?? null;
      const personId = await this.entities.resolveSubjectPersonId(event.tenantId, {
        speakerParticipantId,
        speakerName,
        authorUserId: null,
        authorPersonId: null,
        authorEmail: null,
      });
      if (!personId) return empty;
      const person = await this.prisma.person.findUnique({
        where: { id: personId },
        select: { name: true },
      });
      return { authorPersonId: personId, authorLabel: person?.name ?? speakerName };
    } catch {
      return empty;
    }
  }

  private async linkCommitmentRecipient(args: {
    tenantId: string;
    blockId: string;
    nameGuess: string;
  }): Promise<void> {
    const guess = args.nameGuess.trim();
    if (guess.length < 2 || guess.length > 100) return;

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
      return;
    }
    const personId = candidates[0]?.id;
    if (!personId) return;
    await this.prisma.ideaBlock.update({
      where: { id_tenantId: { id: args.blockId, tenantId: args.tenantId } },
      data: { commitmentRecipientPersonId: personId },
    });
  }

  private async onJobFailed(job: Job<RawEventJobData> | null, err: Error): Promise<void> {
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
    const ext = event.sourceExternalId;
    if (typeof ext === 'string' && ext.startsWith('doc:')) {
      result.documentId = ext.slice('doc:'.length);
    }
    return result;
  }

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
          tenantId: event.tenantId,
          themeId,
          blockId,
          weight: new Prisma.Decimal('0.8'),
        })),
        skipDuplicates: true,
      });
    }
  }

  private async createStructuralEntityEdges(tenantId: string, blockIds: string[]): Promise<void> {
    if (blockIds.length === 0) return;
    const cap = await this.cfg.getDynamic<number>(
      'knowledge.structural_shares_entity_topk',
      undefined,
      10,
    );
    for (const blockId of blockIds) {
      const ents = await this.prisma.ideaBlockEntity.findMany({
        where: { blockId },
        select: { entityId: true },
      });
      if (ents.length === 0) continue;
      const entityIds = ents.map((e) => e.entityId);
      const others = await this.prisma.ideaBlockEntity.findMany({
        where: { entityId: { in: entityIds }, blockId: { not: blockId }, block: { tenantId } },
        select: { blockId: true },
        distinct: ['blockId'],
        take: cap,
      });
      for (const o of others) {
        if (o.blockId === blockId) continue;
        await this.prisma.ideaBlockLink
          .upsert({
            where: {
              fromBlockId_toBlockId_relationType_tenantId: {
                fromBlockId: blockId,
                toBlockId: o.blockId,
                relationType: 'shares_entity',
                tenantId,
              },
            },
            update: { status: 'active', deletedAt: null, deletedBy: null },
            create: {
              tenantId,
              fromBlockId: blockId,
              toBlockId: o.blockId,
              relationType: 'shares_entity',
              confidence: new Prisma.Decimal('1.000'),
              explanation: 'Общая сущность (структурная связь)',
              createdBy: 'system',
              status: 'active',
            },
          })
          .catch(() => undefined);
      }
    }
  }

  private parseDecidedAt(input: string | null | undefined): Date | null {
    if (!input) return null;
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private warnTypedFail(type: string, name: string, err: unknown): TypedFailReason {
    const reason = classifyTypedFailReason(err);
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
