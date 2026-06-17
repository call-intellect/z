import type { JobsOptions } from 'bullmq';

export const CORE_QUEUE_NAMES = {
  RAW_EVENTS: 'core.raw-events',
  BLOCK_DISTILL: 'core.block-distill',
  BLOCK_LINKER: 'core.block-linker',
  ENTITY_RESOLVER: 'core.entity-resolver',
  THEME_CLUSTERER: 'core.theme-clusterer',
  CARD_ROLLUP_V2: 'core.card-rollup-v2',
  MEETING_REPORT_FAST: 'core.meeting-report-fast',
  STRATEGIC_ALIGNMENT: 'core.strategic-alignment',
  ROLE_PROFILE: 'core.role-profile',
  DOCUMENT_UPLOADED: 'core.document-uploaded',
  DUMP_CREATED: 'core.dump-created',
  DOCUMENT_IMPORT: 'core.document-import',
  SPECIALIST_ROUTING: 'core.specialist-routing',
  KNOWLEDGE_CLONE_REBUILD: 'core.knowledge-clone-rebuild',
  PROBE_EVENTS: 'core.probe-events',
  IDEA_CLUSTERER: 'core.idea-clusterer',
  SKILL_PROFILE_REBUILD: 'core.skill-profile-rebuild',
  RECOGNITION_FORMULATE: 'core.recognition-formulate',
  EVENT_REMINDERS: 'core.event-reminders',
  PUSH_SEND: 'core.push-send',
  SPECIALISTS_COMBINED: 'core.specialists-combined',
} as const;

export type CoreQueueName = (typeof CORE_QUEUE_NAMES)[keyof typeof CORE_QUEUE_NAMES];

export const CORE_DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 86400, count: 1000 },
  removeOnFail: false,
};

export interface RawEventJobData {
  rawEventId: string;
  traceId?: string;
}

export interface BlockDistillJobData {
  blockId: string;
  traceId?: string;
}

export interface BlockLinkerJobData {
  blockId: string;
  traceId?: string;
}

export interface EntityResolverJobData {
  entityId: string;
  traceId?: string;
}

export interface CardRollupV2JobData {
  cardId: string;
  reason?: string;
  traceId?: string;
}

export interface MeetingReportFastJobData {
  meetingId: string;
}

export interface SpecialistsCombinedJobData {
  meetingId: string;
}

export interface StrategicAlignmentJobData {
  tenantId: string;
  goalId: string;
  manual?: boolean;
  windowDays?: number;
}

export interface RoleProfileJobData {
  tenantId: string;
  roleId: string;
  triggerReason: 'cron' | 'on-demand' | 'stale-detected';
  triggeredByUserId?: string;
}

export interface DocumentUploadedJobData {
  documentId: string;
  tenantId: string;
}

export interface DumpCreatedJobData {
  documentId: string;
  tenantId: string;
  uploaderPersonId: string;
  content: string;
}

export interface DocumentImportJobData {
  importId: string;
  tenantId: string;
  traceId?: string;
  confluence?: {
    baseUrl: string;
    email: string;
    spaceKey: string;
    encryptedToken: string;
  };
}

export interface SpecialistRoutingJobData {
  blockId: string;
  tenantId: string;
  signalType: string;
  specialistName: string;
  traceId?: string;
}

export interface SprintHelperJobData {
  cycleId: string;
  tenantId: string;
  reason?: 'cron' | 'meeting_completed' | 'manual';
  traceId?: string;
}

export interface RebuildKnowledgeProfileJobData {
  personId: string;
  tenantId: string;
  reason?: string;
  traceId?: string;
}

export interface ProbeEventJobData {
  probeEventId: string;
}

export interface IdeaClustererJobData {
  tenantId: string;
  traceId?: string;
}

export interface RebuildSkillProfileJobData {
  profileId: string;
  tenantId: string;
  reason?: string;
  traceId?: string;
}

export interface PushSendJobData {
  tenantId: string;
  userId: string;
  title: string;
  body: string;
  icon?: string;
  data?: Record<string, unknown>;
}

export interface EventReminderJobData {
  reminderId: string;
}

export interface RecognitionFormulateJobData {
  tenantId: string;
  type:
    | 'thanks_comment'
    | 'thanks_helpfulness'
    | 'mention_helped'
    | 'idea_shipped'
    | 'streak_milestone'
    | 'weekly_summary';
  toUserId: string;
  fromUserId?: string | null;
  contextEntityType?:
    | 'issue_comment'
    | 'insight'
    | 'regulation'
    | 'idea'
    | 'checkin'
    | 'helpfulness_spotlight'
    | null;
  contextEntityId?: string | null;
  message?: string | null;
  visibility?: 'private' | 'team' | 'public_org';
  contextPayload?: Record<string, unknown>;
}
