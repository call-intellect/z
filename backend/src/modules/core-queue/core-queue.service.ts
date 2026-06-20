import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type JobsOptions, Queue } from 'bullmq';

import { TypedConfigService } from '../../common/config/index';
import { RedisService } from '../../common/redis/redis.service';
import { RequestContextService } from '../logging/request-context.service';

import {
  type BlockDistillJobData,
  type BlockLinkerJobData,
  type CardRollupV2JobData,
  CORE_DEFAULT_JOB_OPTIONS,
  CORE_QUEUE_NAMES,
  type CoreQueueName,
  type DocumentImportJobData,
  type DocumentUploadedJobData,
  type DumpCreatedJobData,
  type EntityResolverJobData,
  type EventReminderJobData,
  type GoalEmbedJobData,
  type MeetingReportFastJobData,
  type SpecialistsCombinedJobData,
  type ProbeEventJobData,
  type PushSendJobData,
  type RawEventJobData,
  type RebuildKnowledgeProfileJobData,
  type RebuildSkillProfileJobData,
  type RecognitionFormulateJobData,
  type RegulationConsolidatorJobData,
  type RoleProfileJobData,
  type SpecialistRoutingJobData,
  type SprintHelperJobData,
  type StrategicAlignmentJobData,
} from './queues';

/**
 * HTTP-side диспетчер knowledge-core очередей. По аналогии с `AiQueueService`.
 *
 * Воркеры (`block-ingest.worker`, `block-distill.worker`, ...) живут в отдельном
 * процессе. На Фазе 2 уже есть consumer'ы для `core.raw-events` и
 * `core.block-distill`; для `core.block-linker` / `core.entity-resolver` /
 * `core.theme-clusterer` jobs накапливаются — Фазы 3-4 их разберут.
 *
 * jobId формируется из id источника — даёт идемпотентность: повторный enqueue
 * для того же `RawEvent` / `IdeaBlock` / `Entity` не создаст дубль job'а
 * (а для distill-очереди — обновит delay-дебаунс).
 */
@Injectable()
export class CoreQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CoreQueueService.name);
  private queues: Map<CoreQueueName, Queue<unknown>> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Optional() @Inject(TypedConfigService) private readonly cfg?: TypedConfigService,
    @Optional() @Inject(RequestContextService) private readonly ctx?: RequestContextService,
  ) {}

  /**
   * Авто-стамп traceId из текущего ALS-контекста в payload джоба. Так trace
   * встречи (mtg_<id>) протекает по всей граф-цепочке: каждый воркер берёт
   * traceId из payload (`deriveTraceFromJob`) и при дальнейшем enqueue
   * ре-стампит его. Если контекста/trace нет или traceId уже задан — no-op.
   */
  private stamp<T extends object>(payload: T): T {
    const traceId = this.ctx?.traceId;
    if (!traceId) return payload;
    if ((payload as Record<string, unknown>)['traceId']) return payload;
    return { ...payload, traceId } as T;
  }

  onModuleInit(): void {
    const connection = this.redis.client;
    const map = new Map<CoreQueueName, Queue<unknown>>();
    for (const name of Object.values(CORE_QUEUE_NAMES)) {
      const opts: JobsOptions = CORE_DEFAULT_JOB_OPTIONS;
      map.set(
        name,
        new Queue<unknown>(name, {
          connection,
          defaultJobOptions: opts,
        }),
      );
    }
    this.queues = map;
    this.logger.log(`CoreQueueService инициализирован (${map.size} очередей)`);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.queues) return;
    for (const q of this.queues.values()) {
      try {
        await q.close();
      } catch (err) {
        this.logger.warn(
          `Ошибка при закрытии очереди ${q.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    this.queues = null;
  }

  // ─────────────────────────── enqueue API ─────────────────────────────────

  /**
   * Публикация события `raw.received`. Consumer — `block-ingest.worker` (Фаза 2).
   * jobId = `raw_<rawEventId>` для идемпотентности.
   *
   * NB: BullMQ 5.x запрещает `:` в Custom Id (см. Job.validateOptions),
   * поэтому используем `_` как разделитель (cuid сам по себе `:` не содержит).
   *
   * `suffix` (Org-Admin Фаза 7 reprocess): когда нужно повторно отправить тот
   * же rawEventId через дедуп-окно BullMQ — добавляем суффикс к jobId. Воркер
   * выполнит повторный ingest идемпотентно (после удаления старых блоков
   * через `OrgAdminKnowledgeService.reprocessRawEvent`).
   */
  async enqueueRawReceived(
    rawEventId: string,
    opts?: { suffix?: string },
  ): Promise<void> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.RAW_EVENTS);
    const jobId = opts?.suffix
      ? `raw_${rawEventId}_v2_${opts.suffix}`
      : `raw_${rawEventId}`;
    const payload: RawEventJobData = { rawEventId };
    await q.add('raw-received', this.stamp(payload), { jobId });
    this.logger.debug(`enqueue core.raw-events rawEventId=${rawEventId} jobId=${jobId}`);
  }

  /**
   * Публикация события `block.distill`. Consumer — `block-distill.worker`
   * (Фаза 2 Шаг 3). По умолчанию — debounce `cfg.knowledgeCore.distillDebounceMs`
   * (30s): несколько подряд идущих enqueue для одного `blockId` сложатся в
   * один отложенный job (BullMQ при тех же jobId обновит delay).
   *
   * Передача `delayMs = 0` — сразу, без дебаунса (например, при тестовом
   * вызове или для повторной попытки уже после canonical → linker chain).
   */
  async enqueueBlockDistill(
    blockId: string,
    opts?: { delayMs?: number },
  ): Promise<void> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.BLOCK_DISTILL);
    const delay =
      opts?.delayMs !== undefined
        ? opts.delayMs
        : this.cfg?.knowledgeCore.distillDebounceMs ?? 30_000;
    const jobId = `block_distill_${blockId}`;
    const payload: BlockDistillJobData = { blockId };
    await q.add('block-distill', this.stamp(payload), { jobId, delay });
    this.logger.debug(
      `enqueue core.block-distill blockId=${blockId} delay=${delay}ms`,
    );
  }

  /**
   * Публикация события `block.linker`. Consumer — `block-linker.worker`
   * (Фаза 3). На Фазе 2 jobs накапливаются.
   * jobId = `block_linker_<blockId>`.
   */
  async enqueueBlockLinker(blockId: string): Promise<void> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.BLOCK_LINKER);
    const jobId = `block_linker_${blockId}`;
    const payload: BlockLinkerJobData = { blockId };
    await q.add('block-linker', this.stamp(payload), { jobId });
    this.logger.debug(`enqueue core.block-linker blockId=${blockId}`);
  }

  /**
   * Публикация события `entity.resolver`. Consumer — `entity-resolver.worker`
   * (Фаза 2 Шаг 4). На текущем шаге jobs не публикуются — очередь готова.
   * jobId = `entity_resolver_<entityId>`.
   */
  async enqueueEntityResolver(entityId: string): Promise<void> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.ENTITY_RESOLVER);
    const jobId = `entity_resolver_${entityId}`;
    const payload: EntityResolverJobData = { entityId };
    await q.add('entity-resolver', this.stamp(payload), { jobId });
    this.logger.debug(`enqueue core.entity-resolver entityId=${entityId}`);
  }

  async enqueueRegulationConsolidator(type: string, cardId: string): Promise<void> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.REGULATION_CONSOLIDATOR);
    const jobId = `regconsolidate_${type}_${cardId}`;
    const payload: RegulationConsolidatorJobData = { type, cardId };
    await q.add('regulation-consolidator', this.stamp(payload), { jobId });
    this.logger.debug(`enqueue core.regulation-consolidator type=${type} cardId=${cardId}`);
  }

  /**
   * Публикация события `card.rollup-v2`. Consumer — `card-rollup-v2.worker`
   * (Фаза 4). Дедуп через `jobId = card_rollup_v2_<cardId>` + `delay`
   * (по умолчанию `cfg.knowledgeCore.cardRollupV2DebounceMs` = 60s).
   *
   * Несколько подряд идущих enqueue для одного `cardId` сложатся в один
   * отложенный job. На передачу `delayMs = 0` — сразу.
   */
  async enqueueCardRollupV2(
    cardId: string,
    opts?: { delayMs?: number; reason?: string },
  ): Promise<void> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.CARD_ROLLUP_V2);
    const delay =
      opts?.delayMs !== undefined
        ? opts.delayMs
        : this.cfg?.knowledgeCore.cardRollupV2DebounceMs ?? 60_000;
    const jobId = `card_rollup_v2_${cardId}`;
    const payload: CardRollupV2JobData = { cardId, reason: opts?.reason };
    await q.add('card-rollup-v2', this.stamp(payload), { jobId, delay });
    this.logger.debug(
      `enqueue core.card-rollup-v2 cardId=${cardId} delay=${delay}ms reason=${opts?.reason ?? 'n/a'}`,
    );
  }

  /**
   * Публикация события `core.meeting-report-fast`
   * (ТЗ 2026-05-25, Фаза 4 — параллельный запуск).
   *
   * Consumer — `MeetingReportFastWorker` (один LLM-вызов поверх СЫРОГО
   * транскрипта → chapters + tasks + summaryFast + qualityScore).
   *
   * Идемпотентность: `jobId = meeting_report_fast_<meetingId>`. Повторный
   * enqueue для той же встречи в окне дедупликации BullMQ не создаст дубль.
   *
   * Producer'ы:
   *   - `MergeWorker` — сразу после успешной склейки turns транскрипта
   *     (без задержки: новая цепочка должна стартовать «в момент готовности
   *     транскрипта»);
   *   - (опц.) ручной запуск из админки / integration-test.
   *
   * NB: НЕ блокирует и не зависит от `ai.analyze` — независимый pipeline.
   */
  async enqueueMeetingReportFast(
    meetingId: string,
    opts?: { delayMs?: number; reason?: string },
  ): Promise<void> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.MEETING_REPORT_FAST);
    // Б35 [K7] — jobId СТРОГО по meetingId, БЕЗ reason-суффикса. Прежде reason
    // (`..._v2`, `..._<source>`) варьировал jobId → дедуп BullMQ обходился, и на
    // одну встречу могли крутиться ДВА meeting-report-fast параллельно
    // (lost-update: оба пишут recap, второй затирает первый). Теперь jobId один —
    // два параллельных job'а на встречу невозможны.
    //
    // Regenerate (reason задан): удаляем прошлый (completed/failed/waiting) job с
    // тем же jobId ПЕРЕД add, чтобы removeOnComplete-дедуп (job висит 24ч) не съел
    // повторную постановку. remove не трогает active-job (BullMQ кинет — глотаем):
    // если предыдущий ещё выполняется, новый под тем же jobId всё равно
    // не добавится — это и есть защита от параллельного дубля.
    const jobId = `meeting_report_fast_${meetingId}`;
    if (opts?.reason) {
      try {
        await q.remove(jobId);
      } catch (err) {
        this.logger.debug(
          `enqueue core.meeting-report-fast meetingId=${meetingId}: remove прошлого job '${jobId}' пропущен (${err instanceof Error ? err.message : String(err)})`,
        );
      }
    }
    const payload: MeetingReportFastJobData = { meetingId };
    const jobOpts: JobsOptions = { jobId };
    if (opts?.delayMs !== undefined && opts.delayMs > 0) {
      jobOpts.delay = opts.delayMs;
    }
    await q.add('meeting-report-fast', this.stamp(payload), jobOpts);
    this.logger.debug(
      `enqueue core.meeting-report-fast meetingId=${meetingId} delay=${opts?.delayMs ?? 0}ms reason=${opts?.reason ?? '-'}`,
    );
  }

  /**
   * ТЗ 2026-05-25 llm-architecture §3 — Specialists Combined (Variant Б+).
   *
   * Enqueue одного job'а в `core.specialists-combined`. Идемпотентность через
   * `jobId = specialists_combined_<meetingId>`: повторный enqueue той же
   * встречи в окне BullMQ не создаст дубль.
   *
   * NB: producer сам должен проверить флаг `SPECIALISTS_COMBINED_ENABLED`
   * перед вызовом. Сам сервис очереди — нейтрален. Прежний cron-producer
   * (MeetingAnalyzeV2Cron) удалён вместе с v2-стеком (2026-06-10).
   */
  async enqueueSpecialistsCombined(
    meetingId: string,
    opts?: { delayMs?: number },
  ): Promise<void> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.SPECIALISTS_COMBINED);
    const jobId = `specialists_combined_${meetingId}`;
    const payload: SpecialistsCombinedJobData = { meetingId };
    const jobOpts: JobsOptions = { jobId };
    if (opts?.delayMs !== undefined && opts.delayMs > 0) {
      jobOpts.delay = opts.delayMs;
    }
    await q.add('specialists-combined', this.stamp(payload), jobOpts);
    this.logger.debug(
      `enqueue core.specialists-combined meetingId=${meetingId} delay=${opts?.delayMs ?? 0}ms`,
    );
  }

  /**
   * Публикация события `strategic.alignment` (Фаза 9). Consumer —
   * `strategic-alignment.worker`. По умолчанию jobId дневной (`strat_<goalId>_<YYYYMMDD>`)
   * — это нужно cron'у, чтобы не запускать одну и ту же цель дважды в день.
   * Для ручного recompute передаём `manual: true` + jobId
   * `strat_manual_<goalId>_<ts>`, чтобы пройти дедуп BullMQ.
   */
  async enqueueStrategicAlignment(args: {
    tenantId: string;
    goalId: string;
    manual?: boolean;
    windowDays?: number;
  }): Promise<{ jobId: string }> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.STRATEGIC_ALIGNMENT);
    const jobId = args.manual
      ? `strat_manual_${args.goalId}_${Date.now()}`
      : `strat_${args.goalId}_${ymdUtc(new Date())}`;
    const payload: StrategicAlignmentJobData = {
      tenantId: args.tenantId,
      goalId: args.goalId,
      ...(args.manual ? { manual: true } : {}),
      ...(args.windowDays !== undefined ? { windowDays: args.windowDays } : {}),
    };
    await q.add('strategic-alignment', this.stamp(payload), { jobId });
    this.logger.debug(
      `enqueue core.strategic-alignment goalId=${args.goalId} jobId=${jobId} manual=${args.manual ? 'true' : 'false'}`,
    );
    return { jobId };
  }

  /**
   * Публикация события `role.profile` (Фаза 0d). Consumer —
   * `RoleProfileWorker`. Идемпотентность через `jobId = role_profile_<roleId>_<buildVersion>`
   * — повторный enqueue для того же roleId+buildVersion не создаст дубль.
   *
   * Для on-demand rebuild — особый jobId (`role_profile_<roleId>_ondemand_<ts>`)
   * с проверкой на стороне controller'а (409 если waiting/active job уже есть).
   */
  async enqueueRoleProfile(args: {
    tenantId: string;
    roleId: string;
    buildVersion: number;
    triggerReason: 'cron' | 'on-demand' | 'stale-detected';
    triggeredByUserId?: string;
  }): Promise<{ jobId: string }> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.ROLE_PROFILE);
    const jobId =
      args.triggerReason === 'on-demand'
        ? `role_profile_${args.roleId}_ondemand_${Date.now()}`
        : `role_profile_${args.roleId}_v${args.buildVersion}`;
    const payload: RoleProfileJobData = {
      tenantId: args.tenantId,
      roleId: args.roleId,
      triggerReason: args.triggerReason,
      ...(args.triggeredByUserId ? { triggeredByUserId: args.triggeredByUserId } : {}),
    };
    await q.add('role-profile-build', this.stamp(payload), { jobId });
    this.logger.debug(
      `enqueue core.role-profile roleId=${args.roleId} jobId=${jobId} trigger=${args.triggerReason}`,
    );
    return { jobId };
  }

  /**
   * Поиск активных/ожидающих job'ов для roleId — нужно controller'у для
   * 409 при on-demand rebuild (см. plans/tz/2026-05-21-phase-0d-role-profile-agent.md §8).
   */
  async findActiveRoleProfileJob(
    roleId: string,
  ): Promise<{ status: 'queued' | 'running'; since: string } | null> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.ROLE_PROFILE);
    const jobs = await q.getJobs(['waiting', 'active', 'delayed']);
    for (const job of jobs) {
      const data = job.data as RoleProfileJobData | undefined;
      if (data?.roleId === roleId) {
        const status = job.processedOn ? ('running' as const) : ('queued' as const);
        const since = new Date(job.processedOn ?? job.timestamp).toISOString();
        return { status, since };
      }
    }
    return null;
  }

  /**
   * Публикация события `document.uploaded` (Фаза 0b). Consumer —
   * `DocumentIngestAdapter`. Идемпотентность через `jobId = doc_<documentId>`
   * — повторный enqueue для того же документа не создаст дубль job'а.
   */
  async enqueueDocumentUploaded(args: {
    tenantId: string;
    documentId: string;
  }): Promise<{ jobId: string }> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.DOCUMENT_UPLOADED);
    const jobId = `doc_${args.documentId}`;
    const payload: DocumentUploadedJobData = {
      tenantId: args.tenantId,
      documentId: args.documentId,
    };
    await q.add('document-uploaded', this.stamp(payload), { jobId });
    this.logger.debug(
      `enqueue core.document-uploaded documentId=${args.documentId} tenantId=${args.tenantId}`,
    );
    return { jobId };
  }

  /**
   * ТЗ-4 Ф7 — публикация события `document.import` (массовый импорт ZIP).
   * Consumer — `DocumentImportWorker`. Идемпотентность через
   * `jobId = docimport_<importId>` — повторный enqueue для того же батча в окне
   * дедупа BullMQ не создаст дубль (а воркер дополнительно делает status-guard).
   */
  async enqueueDocumentImport(args: {
    tenantId: string;
    importId: string;
    /**
     * ТЗ-4 Ф9 — параметры Confluence (только для source=confluence). `encryptedToken`
     * — уже зашифрованный `CryptoService.encrypt(apiToken)`; в открытом виде в Redis
     * не попадает. Воркер расшифрует его перед вызовом `ConfluenceClient`.
     */
    confluence?: {
      baseUrl: string;
      email: string;
      spaceKey: string;
      encryptedToken: string;
    };
  }): Promise<{ jobId: string }> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.DOCUMENT_IMPORT);
    const jobId = `docimport_${args.importId}`;
    const payload: DocumentImportJobData = {
      tenantId: args.tenantId,
      importId: args.importId,
      ...(args.confluence ? { confluence: args.confluence } : {}),
    };
    await q.add('document-import', this.stamp(payload), { jobId });
    this.logger.debug(
      `enqueue core.document-import importId=${args.importId} tenantId=${args.tenantId}`,
    );
    return { jobId };
  }

  /**
   * Публикация события `dump.created` (Фаза 0b). Consumer — `TextIngestAdapter`.
   * Передаём весь `content` в payload, чтобы воркер не лез в БД за parsedText'ом.
   * Идемпотентность через `jobId = dump_<documentId>`.
   */
  async enqueueDumpCreated(args: {
    tenantId: string;
    documentId: string;
    uploaderPersonId: string;
    content: string;
  }): Promise<{ jobId: string }> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.DUMP_CREATED);
    const jobId = `dump_${args.documentId}`;
    const payload: DumpCreatedJobData = {
      tenantId: args.tenantId,
      documentId: args.documentId,
      uploaderPersonId: args.uploaderPersonId,
      content: args.content,
    };
    await q.add('dump-created', this.stamp(payload), { jobId });
    this.logger.debug(
      `enqueue core.dump-created documentId=${args.documentId} tenantId=${args.tenantId}`,
    );
    return { jobId };
  }

  /**
   * SBA α-3 — публикация события `specialist.routing` для одного специалиста
   * Слоя 3. jobName = `specialistName`, jobId = `<specialistName>_<blockId>`
   * → идемпотентно: повторный enqueue для того же блока в того же специалиста
   * не создаст дубль.
   *
   * На α-3 consumer'ы ещё не запущены — job накапливается, специалист подберёт
   * её, когда появится (α-6/α-7/β-2/β-3/γ-1).
   */
  async enqueueSpecialistRouting(args: {
    specialistName: string;
    blockId: string;
    tenantId: string;
    signalType: string;
  }): Promise<{ jobId: string }> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.SPECIALIST_ROUTING);
    const jobId = `${args.specialistName}_${args.blockId}`;
    const payload: SpecialistRoutingJobData = {
      blockId: args.blockId,
      tenantId: args.tenantId,
      signalType: args.signalType,
      specialistName: args.specialistName,
    };
    await q.add(args.specialistName, this.stamp(payload), { jobId });
    this.logger.debug(
      `enqueue core.specialist-routing specialist=${args.specialistName} blockId=${args.blockId} signalType=${args.signalType} jobId=${jobId}`,
    );
    return { jobId };
  }

  /**
   * KC-Temporal W3.5 — публикация события `specialist.routing` с
   * **кастомным** jobId и опц. delay. Используется
   * `ProjectionRebuilderService` для дедупа rebuild-job'ов по проекции
   * (jobId = `projection-rebuild_<kind>_<projectionId>`), а не по блоку.
   *
   * NB: BullMQ 5.x запрещает `:` в Custom Id (см. Job.validateOptions),
   * поэтому caller обязан использовать `_` как разделитель.
   *
   * При повторном enqueue в окне `delayMs` BullMQ обновит delay
   * существующего delayed-job'а (через дедуп) — итого один rebuild
   * на окно дебаунса.
   */
  async enqueueSpecialistRoutingWithCustomJobId(args: {
    specialistName: string;
    blockId: string;
    tenantId: string;
    signalType: string;
    jobId: string;
    delayMs?: number;
  }): Promise<{ jobId: string }> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.SPECIALIST_ROUTING);
    const payload: SpecialistRoutingJobData = {
      blockId: args.blockId,
      tenantId: args.tenantId,
      signalType: args.signalType,
      specialistName: args.specialistName,
    };
    const opts: JobsOptions = { jobId: args.jobId };
    if (args.delayMs !== undefined && args.delayMs > 0) {
      opts.delay = args.delayMs;
    }
    await q.add(args.specialistName, this.stamp(payload), opts);
    this.logger.debug(
      `enqueue core.specialist-routing (custom jobId) specialist=${args.specialistName} blockId=${args.blockId} jobId=${args.jobId} delay=${args.delayMs ?? 0}ms`,
    );
    return { jobId: args.jobId };
  }

  /**
   * Sprints (2026-05-27, plans/tz/2026-05-27-sprints.md §2.4) — публикация
   * job для Specialist 3-13 «Помощник по спринтам». Использует ту же очередь
   * `core.specialist-routing`, но с jobName='3-13-sprint-helper' и payload по
   * cycleId (не blockId). jobId='3-13-sprint-helper_<cycleId>' — дедупликация
   * один на спринт (cron каждые 4ч + событие meeting_completed не плодят дубли).
   */
  async enqueueSprintHelper(args: {
    cycleId: string;
    tenantId: string;
    reason?: 'cron' | 'meeting_completed' | 'manual';
  }): Promise<{ jobId: string }> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.SPECIALIST_ROUTING);
    const jobId = `3-13-sprint-helper_${args.cycleId}`;
    const payload: SprintHelperJobData = {
      cycleId: args.cycleId,
      tenantId: args.tenantId,
      ...(args.reason ? { reason: args.reason } : {}),
    };
    await q.add('3-13-sprint-helper', this.stamp(payload), { jobId });
    this.logger.debug(
      `enqueue sprint-helper cycleId=${args.cycleId} reason=${args.reason ?? '—'} jobId=${jobId}`,
    );
    return { jobId };
  }

  /**
   * SBA β-2 — публикация события `knowledge-clone.rebuild`. Consumer —
   * `KnowledgeCloneRebuildWorker`. jobId = `rebuild-knowledge-profile_<personId>`
   * — повторный enqueue для того же Person'а в окне debounce обновит delay
   * (BullMQ + наш дебаунс) → один итоговый rebuild.
   *
   * `delayMs` по умолчанию — `cfg.knowledgeClone.debounceMs` (60s); 0 — сразу
   * (для cron'а / ручного recompute).
   */
  async enqueueRebuildKnowledgeProfile(args: {
    personId: string;
    tenantId: string;
    reason?: string;
    delayMs?: number;
  }): Promise<{ jobId: string }> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.KNOWLEDGE_CLONE_REBUILD);
    const delay =
      args.delayMs !== undefined
        ? args.delayMs
        : this.cfg?.knowledgeClone.debounceMs ?? 60_000;
    const jobId = `rebuild-knowledge-profile_${args.personId}`;
    const payload: RebuildKnowledgeProfileJobData = {
      personId: args.personId,
      tenantId: args.tenantId,
      ...(args.reason ? { reason: args.reason } : {}),
    };
    await q.add('rebuild-knowledge-profile', this.stamp(payload), { jobId, delay });
    this.logger.debug(
      `enqueue core.knowledge-clone-rebuild personId=${args.personId} delay=${delay}ms reason=${args.reason ?? 'n/a'}`,
    );
    return { jobId };
  }

  /**
   * SBA β-5 — публикация probe-event для Layer 6 dispatcher'а. jobId =
   * `probe_<probeEventId>` — идемпотентно (повторный enqueue по тому же
   * probe-event не создаст дубля). Реальный probe уже хранится в БД с
   * status='pending'.
   */
  async enqueueProbeEvent(args: {
    probeEventId: string;
    delayMs?: number;
  }): Promise<{ jobId: string }> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.PROBE_EVENTS);
    const jobId = `probe_${args.probeEventId}`;
    const payload: ProbeEventJobData = { probeEventId: args.probeEventId };
    const opts: JobsOptions = { jobId };
    if (args.delayMs !== undefined && args.delayMs > 0) {
      opts.delay = args.delayMs;
    }
    await q.add('probe-event', this.stamp(payload), opts);
    this.logger.debug(
      `enqueue core.probe-events probeEventId=${args.probeEventId} delay=${args.delayMs ?? 0}ms`,
    );
    return { jobId };
  }

  /**
   * SBA γ-1 — публикация события `skill-profile.rebuild`. Consumer —
   * `SkillProfileRebuildWorker`. jobId = `skill-profile-rebuild_<profileId>`
   * — повторный enqueue для того же профиля в окне debounce обновит delay →
   * один итоговый rebuild. `delayMs` по умолчанию `cfg.skill.rebuildDebounceMs`
   * (60s); 0 — сразу (для cron'а / ручного recompute).
   */
  async enqueueRebuildSkillProfile(args: {
    profileId: string;
    tenantId: string;
    reason?: string;
    delayMs?: number;
  }): Promise<{ jobId: string }> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.SKILL_PROFILE_REBUILD);
    const delay =
      args.delayMs !== undefined
        ? args.delayMs
        : this.cfg?.skill.rebuildDebounceMs ?? 60_000;
    const jobId = `skill-profile-rebuild_${args.profileId}`;
    const payload: RebuildSkillProfileJobData = {
      profileId: args.profileId,
      tenantId: args.tenantId,
      ...(args.reason ? { reason: args.reason } : {}),
    };
    await q.add('rebuild-skill-profile', this.stamp(payload), { jobId, delay });
    this.logger.debug(
      `enqueue core.skill-profile-rebuild profileId=${args.profileId} delay=${delay}ms reason=${args.reason ?? 'n/a'}`,
    );
    return { jobId };
  }

  /**
   * Wave 2 Recognition — публикация `core.recognition-formulate`. Consumer —
   * `RecognitionFormulateWorker`. jobId формируется из `(type, контекст)` —
   * идемпотентно: повторный enqueue для той же благодарности (например, повторный
   * клик «спасибо» уже после unthanks/thanks) не создаст дубль Recognition.
   *
   * Маппинг jobId:
   *   - thanks_comment       — `recognition_thanks_comment_<contextEntityId>_<fromUserId>`
   *   - thanks_helpfulness   — `recognition_thanks_helpfulness_<contextEntityId>_<fromUserId|ai>`
   *   - mention_helped       — `recognition_mention_helped_<contextEntityId>_<toUserId>`
   *   - idea_shipped         — `recognition_idea_shipped_<contextEntityId>_<toUserId>`
   *   - streak_milestone     — `recognition_streak_<toUserId>_<contextEntityId>` (contextEntityId =
   *                            `<days>` или `<YYYY-MM-DD>` для уникальности)
   *   - weekly_summary       — `recognition_weekly_<toUserId>_<contextEntityId>` (contextEntityId =
   *                            `<YYYY-WW>` от cron'а)
   */
  async enqueueRecognitionFormulate(
    args: RecognitionFormulateJobData,
  ): Promise<{ jobId: string }> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.RECOGNITION_FORMULATE);
    const ctxKey = args.contextEntityId ?? 'none';
    const fromKey = args.fromUserId ?? 'ai';
    let jobId: string;
    switch (args.type) {
      case 'thanks_comment':
        jobId = `recognition_thanks_comment_${ctxKey}_${fromKey}`;
        break;
      case 'thanks_helpfulness':
        jobId = `recognition_thanks_helpfulness_${ctxKey}_${fromKey}`;
        break;
      case 'mention_helped':
        jobId = `recognition_mention_helped_${ctxKey}_${args.toUserId}`;
        break;
      case 'idea_shipped':
        jobId = `recognition_idea_shipped_${ctxKey}_${args.toUserId}`;
        break;
      case 'streak_milestone':
        jobId = `recognition_streak_${args.toUserId}_${ctxKey}`;
        break;
      case 'weekly_summary':
        jobId = `recognition_weekly_${args.toUserId}_${ctxKey}`;
        break;
    }
    await q.add('recognition-formulate', this.stamp(args), { jobId });
    this.logger.debug(
      `enqueue core.recognition-formulate type=${args.type} toUserId=${args.toUserId} jobId=${jobId}`,
    );
    return { jobId };
  }

  /**
   * Wave 2 — публикация `core.push-send`. Consumer — `PushSenderWorker`.
   *
   * jobId = `push_<userId>_<sha1(title+body).slice(0,12)>_<bucketMinute>`
   *   — повторный enqueue той же благодарности/уведомления в ту же минуту
   *   на того же user'а не создаст дубль push'а.
   *
   * NB: BullMQ 5.x запрещает `:` в Custom Id; используем `_`.
   */
  async enqueuePushSend(data: PushSendJobData): Promise<{ jobId: string }> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.PUSH_SEND);
    const bucket = Math.floor(Date.now() / 60_000);
    const hashSrc = `${data.title}\n${data.body}`;
    // sha1 короткий и достаточен для дедупа в минутном окне; без crypto
    // import'а — пишем простой FNV-1a 32-бит для cheap-dedupKey.
    let hash = 0x811c9dc5;
    for (let i = 0; i < hashSrc.length; i++) {
      hash ^= hashSrc.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    const hashHex = hash.toString(16).padStart(8, '0').slice(0, 12);
    const jobId = `push_${data.userId}_${hashHex}_${bucket}`;
    await q.add('push-send', this.stamp(data), { jobId });
    this.logger.debug(
      `enqueue core.push-send userId=${data.userId} jobId=${jobId}`,
    );
    return { jobId };
  }

  /**
   * Calendar MVP (2026-05-25) — публикация события `core.event-reminders`.
   * Consumer — `EventRemindersWorker`. jobId = reminderId → идемпотентно:
   * повторный enqueue того же reminder'а из cron'а в окне дедупа BullMQ не
   * создаст дубля.
   */
  async enqueueEventReminder(args: {
    reminderId: string;
  }): Promise<{ jobId: string }> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.EVENT_REMINDERS);
    const jobId = `event_reminder_${args.reminderId}`;
    const payload: EventReminderJobData = { reminderId: args.reminderId };
    await q.add('event-reminder', this.stamp(payload), { jobId });
    this.logger.debug(
      `enqueue core.event-reminders reminderId=${args.reminderId} jobId=${jobId}`,
    );
    return { jobId };
  }

  /**
   * Ф5 (TZ 2026-06-16) — публикация события `core.goal-embed`. Consumer —
   * `GoalEmbedWorker`. jobId = `goal_embed_<goalId>` → идемпотентно: повторный
   * enqueue для той же цели в окне дедупа BullMQ не создаст дубль (а воркер
   * дополнительно делает hash-skip). Best-effort: caller вызывает
   * fire-and-forget `void`, ошибки тут глотать не нужно (caller их игнорирует).
   */
  async enqueueGoalEmbed(args: {
    tenantId: string;
    goalId: string;
  }): Promise<{ jobId: string }> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.GOAL_EMBED);
    const jobId = `goal_embed_${args.goalId}`;
    const payload: GoalEmbedJobData = {
      tenantId: args.tenantId,
      goalId: args.goalId,
    };
    await q.add('goal-embed', this.stamp(payload), { jobId });
    this.logger.debug(
      `enqueue core.goal-embed goalId=${args.goalId} tenantId=${args.tenantId} jobId=${jobId}`,
    );
    return { jobId };
  }

  // ─────────────────────────── internals ───────────────────────────────────

  private requireQueue(name: CoreQueueName): Queue<unknown> {
    const map = this.queues;
    if (!map) {
      throw new Error('CoreQueueService: попытка enqueue до onModuleInit');
    }
    const q = map.get(name);
    if (!q) {
      throw new Error(`CoreQueueService: очередь ${name} не инициализирована`);
    }
    return q;
  }
}

/**
 * `YYYYMMDD` в UTC. Используется для дневной дедупликации jobId
 * strategic-alignment cron'а (Фаза 9).
 */
function ymdUtc(d: Date): string {
  const y = d.getUTCFullYear().toString().padStart(4, '0');
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = d.getUTCDate().toString().padStart(2, '0');
  return `${y}${m}${day}`;
}
