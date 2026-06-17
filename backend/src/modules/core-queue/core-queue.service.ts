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
  type IdeaClustererJobData,
  type MeetingReportFastJobData,
  type SpecialistsCombinedJobData,
  type ProbeEventJobData,
  type PushSendJobData,
  type RawEventJobData,
  type RebuildKnowledgeProfileJobData,
  type RebuildSkillProfileJobData,
  type RecognitionFormulateJobData,
  type RoleProfileJobData,
  type SpecialistRoutingJobData,
  type SprintHelperJobData,
  type StrategicAlignmentJobData,
} from './queues';

@Injectable()
export class CoreQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CoreQueueService.name);
  private queues: Map<CoreQueueName, Queue<unknown>> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Optional() @Inject(TypedConfigService) private readonly cfg?: TypedConfigService,
    @Optional() @Inject(RequestContextService) private readonly ctx?: RequestContextService,
  ) {}

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

  async enqueueRawReceived(rawEventId: string, opts?: { suffix?: string }): Promise<void> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.RAW_EVENTS);
    const jobId = opts?.suffix ? `raw_${rawEventId}_v2_${opts.suffix}` : `raw_${rawEventId}`;
    const payload: RawEventJobData = { rawEventId };
    await q.add('raw-received', this.stamp(payload), { jobId });
    this.logger.debug(`enqueue core.raw-events rawEventId=${rawEventId} jobId=${jobId}`);
  }

  async enqueueBlockDistill(blockId: string, opts?: { delayMs?: number }): Promise<void> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.BLOCK_DISTILL);
    const delay =
      opts?.delayMs !== undefined
        ? opts.delayMs
        : (this.cfg?.knowledgeCore.distillDebounceMs ?? 30_000);
    const jobId = `block_distill_${blockId}`;
    const payload: BlockDistillJobData = { blockId };
    await q.add('block-distill', this.stamp(payload), { jobId, delay });
    this.logger.debug(`enqueue core.block-distill blockId=${blockId} delay=${delay}ms`);
  }

  async enqueueBlockLinker(blockId: string): Promise<void> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.BLOCK_LINKER);
    const jobId = `block_linker_${blockId}`;
    const payload: BlockLinkerJobData = { blockId };
    await q.add('block-linker', this.stamp(payload), { jobId });
    this.logger.debug(`enqueue core.block-linker blockId=${blockId}`);
  }

  async enqueueEntityResolver(entityId: string): Promise<void> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.ENTITY_RESOLVER);
    const jobId = `entity_resolver_${entityId}`;
    const payload: EntityResolverJobData = { entityId };
    await q.add('entity-resolver', this.stamp(payload), { jobId });
    this.logger.debug(`enqueue core.entity-resolver entityId=${entityId}`);
  }

  async enqueueCardRollupV2(
    cardId: string,
    opts?: { delayMs?: number; reason?: string },
  ): Promise<void> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.CARD_ROLLUP_V2);
    const delay =
      opts?.delayMs !== undefined
        ? opts.delayMs
        : (this.cfg?.knowledgeCore.cardRollupV2DebounceMs ?? 60_000);
    const jobId = `card_rollup_v2_${cardId}`;
    const payload: CardRollupV2JobData = { cardId, reason: opts?.reason };
    await q.add('card-rollup-v2', this.stamp(payload), { jobId, delay });
    this.logger.debug(
      `enqueue core.card-rollup-v2 cardId=${cardId} delay=${delay}ms reason=${opts?.reason ?? 'n/a'}`,
    );
  }

  async enqueueMeetingReportFast(
    meetingId: string,
    opts?: { delayMs?: number; reason?: string },
  ): Promise<void> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.MEETING_REPORT_FAST);
    const jobId = opts?.reason
      ? `meeting_report_fast_${meetingId}_${opts.reason}`
      : `meeting_report_fast_${meetingId}`;
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

  async enqueueSpecialistsCombined(meetingId: string, opts?: { delayMs?: number }): Promise<void> {
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

  async enqueueDocumentImport(args: {
    tenantId: string;
    importId: string;
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

  async enqueueRebuildKnowledgeProfile(args: {
    personId: string;
    tenantId: string;
    reason?: string;
    delayMs?: number;
  }): Promise<{ jobId: string }> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.KNOWLEDGE_CLONE_REBUILD);
    const delay =
      args.delayMs !== undefined ? args.delayMs : (this.cfg?.knowledgeClone.debounceMs ?? 60_000);
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

  async enqueueIdeaClusterer(args: { tenantId: string }): Promise<{ jobId: string }> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.IDEA_CLUSTERER);
    const bucket = Math.floor(Date.now() / 60_000);
    const jobId = `idea_cluster_${args.tenantId}_${bucket}`;
    const payload: IdeaClustererJobData = { tenantId: args.tenantId };
    await q.add('idea-clusterer', this.stamp(payload), { jobId });
    return { jobId };
  }

  async enqueueRebuildSkillProfile(args: {
    profileId: string;
    tenantId: string;
    reason?: string;
    delayMs?: number;
  }): Promise<{ jobId: string }> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.SKILL_PROFILE_REBUILD);
    const delay =
      args.delayMs !== undefined ? args.delayMs : (this.cfg?.skill.rebuildDebounceMs ?? 60_000);
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

  async enqueueRecognitionFormulate(args: RecognitionFormulateJobData): Promise<{ jobId: string }> {
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

  async enqueuePushSend(data: PushSendJobData): Promise<{ jobId: string }> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.PUSH_SEND);
    const bucket = Math.floor(Date.now() / 60_000);
    const hashSrc = `${data.title}\n${data.body}`;
    let hash = 0x811c9dc5;
    for (let i = 0; i < hashSrc.length; i++) {
      hash ^= hashSrc.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    const hashHex = hash.toString(16).padStart(8, '0').slice(0, 12);
    const jobId = `push_${data.userId}_${hashHex}_${bucket}`;
    await q.add('push-send', this.stamp(data), { jobId });
    this.logger.debug(`enqueue core.push-send userId=${data.userId} jobId=${jobId}`);
    return { jobId };
  }

  async enqueueEventReminder(args: { reminderId: string }): Promise<{ jobId: string }> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.EVENT_REMINDERS);
    const jobId = `event_reminder_${args.reminderId}`;
    const payload: EventReminderJobData = { reminderId: args.reminderId };
    await q.add('event-reminder', this.stamp(payload), { jobId });
    this.logger.debug(`enqueue core.event-reminders reminderId=${args.reminderId} jobId=${jobId}`);
    return { jobId };
  }

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

function ymdUtc(d: Date): string {
  const y = d.getUTCFullYear().toString().padStart(4, '0');
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = d.getUTCDate().toString().padStart(2, '0');
  return `${y}${m}${day}`;
}
