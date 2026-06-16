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
import {
  type BlockDistillJobData,
  CORE_QUEUE_NAMES,
} from '../../core-queue/queues';
import { WorkerOrgGate } from '../../core-queue/worker-org-gate';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { BlockMergeService } from '../services/block-merge.service';
import { FactSupersedeService } from '../services/fact-supersede.service';
import type { IdeaBlockUpdatedEvent } from '../services/projection-rebuilder.service';
import { RouterService } from '../services/router.service';

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

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BlockMergeService) private readonly merger: BlockMergeService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Inject(WorkerOrgGate) private readonly gate: WorkerOrgGate,
    // Ф3 МТЗ «разблокировка конвейера» — диспатч специалистов перенесён сюда
    // из block-ingest. Специалисты обрабатывают только `canonical`, поэтому
    // dispatch вызывается на переходе draft→canonical (markCanonical /
    // mergeInto), а не на свежесозданном draft-блоке.
    @Inject(RouterService) private readonly router: RouterService,
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

    // Report-to-graph Ф4 ГАРД B (детерминированный пост-гард) — транскрипт
    // ПОБЕЖДАЕТ при дедупе с отчётом. Опасный случай: LLM решил merge, НОВЫЙ
    // блок — транскриптный (первичный, дословный), а выбранный canonical —
    // из отчёта (вторичный). Слепой mergeInto превратил бы транскрипт в
    // merged_into под report-canonical → провенанс деградирует. Вместо этого
    // разворачиваем направление: транскрипт становится canonical-носителем,
    // report → merged_into. Условие СТРОГОЕ по primarySource, поэтому
    // transcript↔transcript и report↔report не затронуты (регресс-тесты Ф4 а/б).
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

    // Ф3 МТЗ «разблокировка конвейера» — диспатч специалистов на переходе в
    // canonical (раньше шёл из block-ingest на draft-блоке, где специалисты
    // молча скипали). Best-effort: dispatch внутри уже не throw'ит, но
    // оборачиваем в .catch на случай падения enqueue/Redis, чтобы не ронять
    // markCanonical (статус блока уже зафиксирован).
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

    // Ф3 МТЗ «разблокировка конвейера» — захватываем signalType канонического
    // блока ВНУТРИ транзакции, чтобы после коммита диспатчить специалистов по
    // правильному типу (мердж мог уточнить сигнал; берём актуальный canonical).
    let canonicalSignalType: SignalType | null = null;

    await this.prisma.$transaction(async (tx) => {
      const canonical = await tx.ideaBlock.findUnique({
        where: { id: canonicalId },
      });
      if (!canonical) {
        throw new Error(
          `block-distill: canonical ${canonicalId} не найден — abort merge`,
        );
      }
      canonicalSignalType = canonical.signalType;
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
      //    делаем по одному с pre-check целевой пары, иначе update
      //    (Б1: без catch P2002 в tx).
      const mentions = await tx.ideaBlockEntity.findMany({
        where: { blockId: block.id },
      });
      for (const m of mentions) {
        // Б1: pre-check вместо catch(P2002) внутри tx — иначе ошибка SQL
        // абортит всю транзакцию (PostgreSQL 25P02), и шаг 4 (обновление
        // canonical) не выполнится. Проверяем целевую пару (canonicalId, entityId).
        const conflicting = await tx.ideaBlockEntity.findUnique({
          where: { blockId_entityId: { blockId: canonicalId, entityId: m.entityId } },
        });
        if (conflicting) {
          // Дубль — удаляем mention со старого блока, оставляем canonical-вариант.
          await tx.ideaBlockEntity.delete({
            where: { blockId_entityId: { blockId: block.id, entityId: m.entityId } },
          });
          continue;
        }
        await tx.ideaBlockEntity.update({
          where: { blockId_entityId: { blockId: block.id, entityId: m.entityId } },
          data: { blockId: canonicalId },
        });
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

    // Ф3 МТЗ «разблокировка конвейера» — диспатч специалистов на canonicalId
    // (живой блок, вобравший evidence/tags merged-блока). signalType берём из
    // canonical, захваченного внутри транзакции. Best-effort: не роняем
    // mergeInto, статус уже зафиксирован.
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
   * Report-to-graph Ф4 ГАРД B — РАЗВОРОТ направления merge.
   *
   * Зеркало `mergeInto`, но роли меняются местами: новый ТРАНСКРИПТНЫЙ блок
   * становится canonical-носителем, а выбранный REPORT-canonical помечается
   * `merged_into` под транскрипт. Срабатывает СТРОГО при
   * `new.primarySource='transcript' && canonical.primarySource='report'`
   * (проверка в `process()`), поэтому transcript↔transcript и report↔report
   * НЕ затрагиваются.
   *
   * Ключевое отличие от `mergeInto`: confidence нового canonical =
   * `max(transcript, report)`, НЕ weighted-average — иначе высокоуверенный
   * транскрипт просел бы в низкоуверенном (capped ≤0.6) report.
   */
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
      // Идемпотентность/гонка: report-canonical мог быть сам merged_into между
      // KNN и сейчас. Безопаснее всего — fallback: новый транскриптный блок
      // просто становится canonical (цепочки merge не выстраиваем).
      if (reportCanonical.status !== 'canonical') {
        throw new Error(
          `block-distill: swap target ${reportCanonicalId} имеет статус ${reportCanonical.status}, не canonical`,
        );
      }

      // 1. Транскриптный блок становится canonical-носителем.
      //    signalType берём с транскрипта (он первичный) — это итоговый тип
      //    для диспатча специалистов после коммита.
      canonicalSignalType = transcriptBlock.signalType;

      // 2. Report-canonical → merged_into под транскрипт.
      await tx.ideaBlock.update({
        where: { id: reportCanonicalId },
        data: {
          status: 'merged_into',
          mergedIntoId: transcriptBlock.id,
        },
      });

      // 3. Переносим все evidence С report НА транскрипт.
      await tx.ideaBlockEvidence.updateMany({
        where: { blockId: reportCanonicalId },
        data: { blockId: transcriptBlock.id },
      });

      // 4. Переносим entity-mention'ы С report НА транскрипт (skip ON CONFLICT
      //    composite PK, как в mergeInto).
      const mentions = await tx.ideaBlockEntity.findMany({
        where: { blockId: reportCanonicalId },
      });
      for (const m of mentions) {
        // Б1: pre-check вместо catch(P2002) внутри tx — иначе ошибка SQL
        // абортит всю транзакцию (PostgreSQL 25P02), и шаг 5 (canonical-носитель)
        // не выполнится. Проверяем целевую пару (transcriptBlock.id, entityId).
        const conflicting = await tx.ideaBlockEntity.findUnique({
          where: {
            blockId_entityId: {
              blockId: transcriptBlock.id,
              entityId: m.entityId,
            },
          },
        });
        if (conflicting) {
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
        await tx.ideaBlockEntity.update({
          where: {
            blockId_entityId: {
              blockId: reportCanonicalId,
              entityId: m.entityId,
            },
          },
          data: { blockId: transcriptBlock.id },
        });
      }

      // 5. Транскрипт делаем canonical-носителем: статус, evidenceCount (сумма),
      //    confidence = MAX (НЕ усреднение — транскрипт не должен просесть в
      //    capped report), tags = union.
      const newEvidenceCount =
        transcriptBlock.evidenceCount + Math.max(1, reportCanonical.evidenceCount);
      const transcriptConf = new Prisma.Decimal(transcriptBlock.confidence);
      const reportConf = new Prisma.Decimal(reportCanonical.confidence);
      const maxConf = transcriptConf.greaterThanOrEqualTo(reportConf)
        ? transcriptConf
        : reportConf;
      const mergedTags = Array.from(
        new Set([...transcriptBlock.tags, ...reportCanonical.tags]),
      );

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

    // 6. Линкер для нового canonical-транскрипта (как markCanonical) — связи
    //    изменились (вобрал evidence/entities report'а).
    await this.coreQueue.enqueueBlockLinker(transcriptBlock.id).catch((err) => {
      this.logger.warn(
        {
          blockId: transcriptBlock.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'block-distill: enqueueBlockLinker(swap canonical) упал — пересчёт отложен',
      );
    });

    this.logger.log(
      {
        transcriptBlockId: transcriptBlock.id,
        reportCanonicalId,
        explanation: args.explanation,
      },
      'block-distill: swapDirection — транскрипт стал canonical, report → merged_into',
    );

    // 7. Диспатч специалистов на новый canonical-транскрипт (как markCanonical
    //    делает для нового canonical). Best-effort — статус уже зафиксирован.
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

    // KC-Temporal W3.5 — emit по новому canonical (транскрипт), changeKind='merged'.
    this.emitIdeaBlockUpdated({
      tenantId: transcriptBlock.tenantId,
      blockId: transcriptBlock.id,
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
