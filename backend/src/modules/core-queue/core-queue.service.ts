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

import {
  type BlockDistillJobData,
  type BlockLinkerJobData,
  type CardRollupV2JobData,
  CORE_DEFAULT_JOB_OPTIONS,
  CORE_QUEUE_NAMES,
  type CoreQueueName,
  type DocumentUploadedJobData,
  type DumpCreatedJobData,
  type EntityResolverJobData,
  type MeetingAnalyzeV2JobData,
  type RawEventJobData,
  type RoleProfileJobData,
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
  ) {}

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
    await q.add('raw-received', payload, { jobId });
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
    await q.add('block-distill', payload, { jobId, delay });
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
    await q.add('block-linker', payload, { jobId });
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
    await q.add('entity-resolver', payload, { jobId });
    this.logger.debug(`enqueue core.entity-resolver entityId=${entityId}`);
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
    await q.add('card-rollup-v2', payload, { jobId, delay });
    this.logger.debug(
      `enqueue core.card-rollup-v2 cardId=${cardId} delay=${delay}ms reason=${opts?.reason ?? 'n/a'}`,
    );
  }

  /**
   * Публикация события `meeting.analyze-v2`. Consumer — `meeting-analyze-v2.worker`
   * (Фаза 5). Дедуп через `jobId = meeting_analyze_v2_<meetingId>` + `delay`
   * (по умолчанию `cfg.knowledgeCore.meetingAnalyzeV2DebounceMs` = 120s — даёт
   * block-distill стабилизироваться).
   *
   * Несколько подряд идущих enqueue для одного `meetingId` сложатся в один
   * отложенный job. На передачу `delayMs = 0` — сразу.
   */
  async enqueueMeetingAnalyzeV2(
    meetingId: string,
    opts?: { delayMs?: number },
  ): Promise<void> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.MEETING_ANALYZE_V2);
    const delay =
      opts?.delayMs !== undefined
        ? opts.delayMs
        : this.cfg?.knowledgeCore.meetingAnalyzeV2DebounceMs ?? 120_000;
    const jobId = `meeting_analyze_v2_${meetingId}`;
    const payload: MeetingAnalyzeV2JobData = { meetingId };
    await q.add('meeting-analyze-v2', payload, { jobId, delay });
    this.logger.debug(
      `enqueue core.meeting-analyze-v2 meetingId=${meetingId} delay=${delay}ms`,
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
    await q.add('strategic-alignment', payload, { jobId });
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
    await q.add('role-profile-build', payload, { jobId });
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
    await q.add('document-uploaded', payload, { jobId });
    this.logger.debug(
      `enqueue core.document-uploaded documentId=${args.documentId} tenantId=${args.tenantId}`,
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
    await q.add('dump-created', payload, { jobId });
    this.logger.debug(
      `enqueue core.dump-created documentId=${args.documentId} tenantId=${args.tenantId}`,
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
