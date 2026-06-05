-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('user', 'admin');

-- CreateEnum
CREATE TYPE "UserSignupSource" AS ENUM ('crossmark', 'standalone');

-- CreateEnum
CREATE TYPE "VerificationPurpose" AS ENUM ('password_reset', 'account_restore', 'magic_link', 'invite_accept');

-- CreateEnum
CREATE TYPE "MeetingType" AS ENUM ('team', 'standup', 'plan_fact', 'project', 'sales', 'custdev', 'partner', 'interview', 'customer_success', 'review', 'retrospective', 'task_discussion', 'sprint_review');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('scheduled', 'active', 'completed', 'recording_processing', 'recording_ready', 'transcription_processing', 'transcription_ready', 'ai_processing', 'ai_ready', 'failed', 'ai_failed');

-- CreateEnum
CREATE TYPE "AiStepStatus" AS ENUM ('none', 'queued', 'processing', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "ParticipantRole" AS ENUM ('host', 'guest');

-- CreateEnum
CREATE TYPE "ParticipantInvitationStatus" AS ENUM ('none', 'invited', 'joined');

-- CreateEnum
CREATE TYPE "RecordingStatus" AS ENUM ('not_started', 'requested', 'recording', 'finalizing', 'ready', 'failed', 'expired', 'archived', 'deleted');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('open', 'in_progress', 'done', 'cancelled');

-- CreateEnum
CREATE TYPE "RenderStatus" AS ENUM ('none', 'queued', 'processing', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "ChatRole" AS ENUM ('user', 'assistant');

-- CreateEnum
CREATE TYPE "ApiKeyScope" AS ENUM ('read', 'write');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('active', 'paused', 'failing');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('pending', 'retrying', 'delivered', 'failed');

-- CreateEnum
CREATE TYPE "DestinationType" AS ENUM ('email', 'slack_webhook', 'telegram_bot', 'generic_webhook');

-- CreateEnum
CREATE TYPE "ExportType" AS ENUM ('meeting_md', 'meeting_pdf', 'meeting_docx', 'bulk_zip');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('queued', 'processing', 'ready', 'failed', 'expired');

-- CreateEnum
CREATE TYPE "OrgVisibilityMode" AS ENUM ('open', 'strict');

-- CreateEnum
CREATE TYPE "OrgTier" AS ENUM ('basic', 'pro', 'enterprise');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('owner', 'admin', 'manager', 'coo', 'hr_partner', 'demo_observer');

-- CreateEnum
CREATE TYPE "OrgInvitationStatus" AS ENUM ('pending', 'accepted', 'revoked', 'expired');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('meeting', 'chat', 'phone_call', 'bot', 'email', 'web_form', 'external', 'conversational', 'tracker_event');

-- CreateEnum
CREATE TYPE "DataClass" AS ENUM ('public', 'internal', 'sensitive', 'private');

-- CreateEnum
CREATE TYPE "PromptTemplateScope" AS ENUM ('system', 'org');

-- CreateEnum
CREATE TYPE "PromptTemplateStatus" AS ENUM ('draft', 'active', 'archived');

-- CreateEnum
CREATE TYPE "RawEventProcessingStatus" AS ENUM ('received', 'ingested', 'failed');

-- CreateEnum
CREATE TYPE "UserCompanyRole" AS ENUM ('founder', 'general_director', 'operations_director', 'department_head', 'team_lead', 'specialist');

-- CreateEnum
CREATE TYPE "SignalType" AS ENUM ('fact', 'pain', 'feature_request', 'objection', 'churn_risk', 'idea', 'risk', 'commitment', 'decision', 'mood', 'drift', 'competitor_move', 'metric_change', 'knowledge_gap', 'reasoning', 'rationale', 'decision_basis', 'regulation', 'process_step', 'expertise', 'experience', 'competence', 'methodology_step', 'hypothesis', 'result', 'lesson', 'brand_principle', 'content_artifact', 'commitment_status', 'plan_item', 'done_item', 'blocker', 'team_friction', 'process_friction', 'resource_gap', 'suggestion', 'client_request', 'question', 'task_created', 'task_status_changed', 'task_blocked', 'task_completed', 'task_overdue', 'task_reassigned', 'task_comment', 'task_mention', 'help_provided', 'proactive_hint', 'mentoring', 'emotional_support', 'constructive_feedback', 'question_unanswered', 'question_acknowledged_no_action', 'helped_by', 'helped_to', 'thanks_explicit');

-- CreateEnum
CREATE TYPE "IdeaBlockStatus" AS ENUM ('draft', 'canonical', 'merged_into', 'archived');

-- CreateEnum
CREATE TYPE "AxisType" AS ENUM ('who', 'functional', 'contextual', 'temporal');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('client', 'person', 'customer', 'vendor', 'project', 'product', 'document', 'goal', 'event', 'topic', 'location', 'technology', 'metric', 'market', 'org_unit', 'custom');

-- CreateEnum
CREATE TYPE "IdeaBlockEntityRole" AS ENUM ('subject', 'object', 'mentioned');

-- CreateEnum
CREATE TYPE "PersonRelationship" AS ENUM ('employee', 'external', 'candidate', 'former');

-- CreateEnum
CREATE TYPE "VendorSegment" AS ENUM ('software', 'hardware', 'consulting', 'logistics', 'other');

-- CreateEnum
CREATE TYPE "VendorStatus" AS ENUM ('active', 'evaluating', 'churned', 'banned');

-- CreateEnum
CREATE TYPE "EventKind" AS ENUM ('meeting', 'incident', 'release', 'transition', 'milestone', 'call', 'offline_meeting', 'personal_block', 'deadline', 'other');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('tentative', 'confirmed', 'cancelled');

-- CreateEnum
CREATE TYPE "EventVisibility" AS ENUM ('company', 'team', 'personal');

-- CreateEnum
CREATE TYPE "EventParticipantRole" AS ENUM ('organizer', 'required', 'optional');

-- CreateEnum
CREATE TYPE "RsvpStatus" AS ENUM ('pending', 'accepted', 'declined', 'tentative');

-- CreateEnum
CREATE TYPE "ReminderChannel" AS ENUM ('push', 'email', 'telegram');

-- CreateEnum
CREATE TYPE "RawEventPayloadStorage" AS ENUM ('inline', 's3');

-- CreateEnum
CREATE TYPE "CurationLevel" AS ENUM ('light', 'deep');

-- CreateEnum
CREATE TYPE "CurationItemStatus" AS ENUM ('pending', 'decided', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "TrustTier" AS ENUM ('auto', 'provisional', 'human');

-- CreateEnum
CREATE TYPE "CurationDecisionType" AS ENUM ('approve', 'reject', 'approve_with_edits', 'split', 'merge', 'supersede', 'mark_as_misleading', 'merge_categories', 'escalate');

-- CreateEnum
CREATE TYPE "ConflictStatus" AS ENUM ('open', 'resolved', 'dismissed');

-- CreateEnum
CREATE TYPE "ConflictResolution" AS ENUM ('accept_new', 'keep_old', 'merge', 'evolving');

-- CreateEnum
CREATE TYPE "IdeaBlockLinkType" AS ENUM ('develops', 'contradicts', 'causes', 'consequences_of', 'shares_topic', 'shares_entity', 'question_answered_by', 'resolves', 'supersedes');

-- CreateEnum
CREATE TYPE "EntityLinkType" AS ENUM ('works_at', 'belongs_to', 'part_of', 'opposes', 'depends_on', 'mentions_with', 'executes_role', 'member_of', 'described_by', 'derived_from', 'requires_skill', 'has_skill', 'realized_by', 'decomposes_into', 'measured_by', 'executed_by', 'has_step', 'owned_by', 'lives_in', 'produces', 'triggered_by', 'regulates', 'constrains', 'applies_to', 'is_responsible_for', 'responsible_for', 'accountable_for', 'consulted_on', 'informed_about', 'reports_to', 'manages', 'collaborates_with', 'mentors', 'conflicted_with', 'transfers_result_to', 'escalates_to', 'result_supports_insight', 'lesson_informs_decision');

-- CreateEnum
CREATE TYPE "LinkCreatedBy" AS ENUM ('linker', 'reframing', 'manual');

-- CreateEnum
CREATE TYPE "LinkStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "ThemeStatus" AS ENUM ('active', 'archived', 'merged_into');

-- CreateEnum
CREATE TYPE "ThemeDynamic" AS ENUM ('growing', 'stable', 'declining');

-- CreateEnum
CREATE TYPE "ThemeBranch" AS ENUM ('strategy', 'clients', 'sales', 'marketing', 'product', 'operations', 'team', 'finance', 'technology', 'production', 'partnerships', 'legal');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('active', 'paused', 'achieved', 'abandoned');

-- CreateEnum
CREATE TYPE "GoalThemeSource" AS ENUM ('manual', 'ai');

-- CreateEnum
CREATE TYPE "GoalHorizon" AS ENUM ('strategic', 'annual', 'quarterly', 'monthly', 'sprint');

-- CreateEnum
CREATE TYPE "GoalSource" AS ENUM ('manual', 'ai');

-- CreateEnum
CREATE TYPE "GoalPromotionState" AS ENUM ('suggested', 'active', 'dismissed');

-- CreateEnum
CREATE TYPE "GoalProgressStatus" AS ENUM ('on_track', 'at_risk', 'stalled', 'achieved', 'dropped');

-- CreateEnum
CREATE TYPE "GoalKrSourceKind" AS ENUM ('manual', 'meeting_count', 'issue_rollup', 'metric_entity');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('pdf', 'docx', 'markdown', 'text', 'other');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('uploaded', 'parsing', 'parsed', 'blocks_extracted', 'failed');

-- CreateEnum
CREATE TYPE "RoleProfileStatus" AS ENUM ('forming', 'ready', 'stale', 'error');

-- CreateEnum
CREATE TYPE "RegulationCategory" AS ENUM ('regulation', 'standard');

-- CreateEnum
CREATE TYPE "ProcessStatus" AS ENUM ('active', 'deprecated', 'archived');

-- CreateEnum
CREATE TYPE "PolicySeverity" AS ENUM ('advisory', 'mandatory', 'blocking');

-- CreateEnum
CREATE TYPE "ToolKind" AS ENUM ('software', 'hardware', 'template', 'document', 'service', 'other');

-- CreateEnum
CREATE TYPE "MetricValueType" AS ENUM ('count', 'ratio', 'duration_seconds', 'money', 'other');

-- CreateEnum
CREATE TYPE "DecisionStatus" AS ENUM ('active', 'rolled_back', 'superseded', 'proposed', 'approved', 'rejected', 'implemented', 'cancelled');

-- CreateEnum
CREATE TYPE "InsightKind" AS ENUM ('problem', 'risk', 'blocker', 'inefficiency');

-- CreateEnum
CREATE TYPE "InsightSeverity" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "InsightDynamic" AS ENUM ('growing', 'stable', 'declining', 'spike');

-- CreateEnum
CREATE TYPE "InsightStatus" AS ENUM ('active', 'mitigating', 'mitigated', 'archived', 'false_alarm');

-- CreateEnum
CREATE TYPE "LlmRouteTier" AS ENUM ('primary', 'secondary', 'tertiary');

-- CreateEnum
CREATE TYPE "IdeaKind" AS ENUM ('internal', 'client_request');

-- CreateEnum
CREATE TYPE "IdeaStatus" AS ENUM ('captured', 'in_discussion', 'accepted', 'in_progress', 'shipped', 'rejected', 'archived');

-- CreateEnum
CREATE TYPE "ProbeStatus" AS ENUM ('pending', 'dispatched', 'dropped_dedup', 'dropped_rate_limit', 'expired', 'dropped_cold_start', 'dropped_dataclass_gate');

-- CreateEnum
CREATE TYPE "MeetingReportStatus" AS ENUM ('pending', 'running', 'ready', 'failed', 'archived');

-- CreateEnum
CREATE TYPE "ChannelKind" AS ENUM ('in_app', 'email_smtp', 'email_imap', 'telegram_bot', 'max_bot');

-- CreateEnum
CREATE TYPE "ChannelDirection" AS ENUM ('inbound_only', 'outbound_only', 'bidirectional');

-- CreateEnum
CREATE TYPE "ChannelStatus" AS ENUM ('active', 'disabled', 'broken', 'global_disabled');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('queued', 'sent_partial', 'delivered', 'read', 'responded', 'failed');

-- CreateEnum
CREATE TYPE "NotificationResponseStatus" AS ENUM ('pending', 'answered', 'dismissed', 'expired');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('queued', 'sent', 'delivered', 'read', 'responded', 'failed');

-- CreateEnum
CREATE TYPE "DailyCheckInSource" AS ENUM ('cron_prompted', 'self_initiated', 'manual');

-- CreateEnum
CREATE TYPE "ChatV2Scope" AS ENUM ('org', 'meeting', 'card', 'theme', 'entity', 'personal', 'issue');

-- CreateEnum
CREATE TYPE "ChatV2MessageRole" AS ENUM ('user', 'assistant');

-- CreateEnum
CREATE TYPE "ChatV2Mode" AS ENUM ('factual', 'synthetic', 'clone_style');

-- CreateEnum
CREATE TYPE "ChatV2ConversationStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "SkillProfileStatus" AS ENUM ('active', 'archived', 'paused_relationship');

-- CreateEnum
CREATE TYPE "SkillConfidence" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "SkillTraitStatus" AS ENUM ('active', 'superseded_by', 'archived', 'misleading');

-- CreateEnum
CREATE TYPE "PersonaScope" AS ENUM ('person', 'role');

-- CreateEnum
CREATE TYPE "PersonaStatus" AS ENUM ('active', 'superseded', 'pending_rebuild');

-- CreateEnum
CREATE TYPE "SkillTraitConceptStatus" AS ENUM ('active', 'merged_into', 'archived');

-- CreateEnum
CREATE TYPE "SkillScope" AS ENUM ('person', 'role', 'org');

-- CreateEnum
CREATE TYPE "PracticeSkillStatus" AS ENUM ('shadow', 'active', 'archived', 'deprecated');

-- CreateEnum
CREATE TYPE "SprintHintKind" AS ENUM ('no_due_date', 'no_description', 'no_assignee', 'due_date_at_risk', 'recurring_carry_over', 'no_recent_mentions', 'conflicts_with_goal', 'can_be_split', 'similar_to_past_task', 'generic');

-- CreateEnum
CREATE TYPE "SprintHintSeverity" AS ENUM ('info', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "SprintHintStatus" AS ENUM ('active', 'dismissed', 'resolved');

-- CreateEnum
CREATE TYPE "MailInboundStatus" AS ENUM ('received', 'bounced', 'failed', 'created');

-- CreateEnum
CREATE TYPE "FeedbackTopicStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'MERGED');

-- CreateEnum
CREATE TYPE "BillingProviderName" AS ENUM ('tochka', 'manual');

-- CreateEnum
CREATE TYPE "BillingPeriod" AS ENUM ('monthly', 'yearly');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('DEMO', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('paid', 'bonus', 'reference');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'issued', 'paid', 'bonus', 'void');

-- CreateEnum
CREATE TYPE "BillingPaymentMethod" AS ENUM ('card_recurring', 'bank_invoice', 'manual_admin', 'bonus');

-- CreateEnum
CREATE TYPE "ReferralLegalForm" AS ENUM ('self_employed', 'individual_entrepreneur', 'legal_entity');

-- CreateEnum
CREATE TYPE "ReferralPayoutStatus" AS ENUM ('pending', 'paid', 'void');

-- CreateEnum
CREATE TYPE "RuleType" AS ENUM ('must_do', 'must_not_do', 'tone', 'structure');

-- CreateEnum
CREATE TYPE "RuleSource" AS ENUM ('autorule', 'manual_admin');

-- CreateEnum
CREATE TYPE "RuleStatus" AS ENUM ('shadow', 'active', 'archived', 'overridden_by_admin');

-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('pareto_pool', 'testing', 'promoted', 'rejected');

-- CreateEnum
CREATE TYPE "TablePropType" AS ENUM ('text', 'longtext', 'number', 'currency', 'percent', 'date', 'status', 'selectSingle', 'selectMulti', 'checkbox', 'person', 'url', 'email', 'phone', 'file', 'formula', 'relation', 'rollup', 'createdAt', 'updatedAt', 'createdBy', 'entityLink', 'meetingLink', 'documentLink');

-- CreateEnum
CREATE TYPE "TableViewType" AS ENUM ('grid', 'kanban', 'calendar', 'gantt', 'gallery', 'timeline', 'map', 'form', 'chart');

-- CreateEnum
CREATE TYPE "TableViewVisibility" AS ENUM ('personal', 'shared', 'public');

-- CreateEnum
CREATE TYPE "SystemLogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL');

-- CreateEnum
CREATE TYPE "SystemLogCategory" AS ENUM ('SYSTEM', 'REQUEST', 'BUSINESS', 'SECURITY', 'PAYMENT', 'WEBHOOK', 'AUTH', 'DB', 'INTEGRATION', 'AUDIT', 'FRONTEND', 'JOB', 'OTHER');

-- CreateEnum
CREATE TYPE "SystemLogContour" AS ENUM ('GUEST', 'MEMBER', 'ORG_ADMIN', 'SUPERADMIN', 'PLATFORM', 'PUBLIC', 'SYSTEM');

-- CreateEnum
CREATE TYPE "SystemLogPipeline" AS ENUM ('MEETING_LIFECYCLE', 'RECORDING', 'TRANSCRIPTION', 'AI_ANALYSIS', 'KNOWLEDGE_GRAPH', 'NOTIFICATIONS', 'AUTH', 'BILLING', 'INTEGRATIONS', 'ONBOARDING', 'ADMIN', 'SCHEDULER', 'SYSTEM');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "externalId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" VARCHAR(20),
    "role" "UserRole" NOT NULL DEFAULT 'user',
    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "signupSource" "UserSignupSource" NOT NULL DEFAULT 'crossmark',
    "signupRef" VARCHAR(255),
    "passwordHash" TEXT,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "consentDataProcessing" BOOLEAN NOT NULL DEFAULT false,
    "consentMarketing" BOOLEAN NOT NULL DEFAULT false,
    "consentAcceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "calendarFeedToken" VARCHAR(80),
    "tourProgress" JSONB NOT NULL DEFAULT '{}',
    "companyRole" "UserCompanyRole",
    "profileCompletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserVerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" "VerificationPurpose" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "MeetingType" NOT NULL,
    "customPrompt" TEXT,
    "tenantId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "cardId" TEXT,
    "roomName" TEXT NOT NULL,
    "status" "MeetingStatus" NOT NULL DEFAULT 'scheduled',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "durationMs" INTEGER,
    "recapVersion" INTEGER NOT NULL DEFAULT 1,
    "chaptersStatus" "AiStepStatus" NOT NULL DEFAULT 'none',
    "tasksStatus" "AiStepStatus" NOT NULL DEFAULT 'none',
    "embeddingsStatus" "AiStepStatus" NOT NULL DEFAULT 'none',
    "analyzeV2Status" TEXT,
    "analyzeV2GeneratedAt" TIMESTAMP(3),
    "analyzeV2Error" TEXT,
    "reportFastStatus" TEXT,
    "reportFastError" TEXT,
    "reportFastGeneratedAt" TIMESTAMP(3),
    "reportFastQualityScore" JSONB,
    "recordByDefault" BOOLEAN NOT NULL DEFAULT true,
    "behaviorMetricsStatus" TEXT,
    "qualityScoreStatus" TEXT,
    "roiScore" DECIMAL(8,3),
    "roiScoreAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "linkedIssueId" TEXT,
    "linkedCycleId" TEXT,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participant" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "livekitIdentity" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "ParticipantRole" NOT NULL,
    "isRegisteredUser" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT,
    "personId" TEXT,
    "invitationStatus" "ParticipantInvitationStatus" NOT NULL DEFAULT 'none',
    "inviteToken" TEXT,
    "invitedAt" TIMESTAMP(3),
    "deviceCount" INTEGER NOT NULL DEFAULT 1,
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recording" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "mainVideoUrl" TEXT,
    "compositeEgressId" TEXT,
    "status" "RecordingStatus" NOT NULL DEFAULT 'not_started',
    "retentionDays" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "bytesTotal" BIGINT,
    "durationSeconds" INTEGER,

    CONSTRAINT "Recording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AudioTrack" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "participantId" TEXT,
    "participantName" TEXT NOT NULL,
    "livekitIdentity" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "trackEgressId" TEXT,
    "voxTaskId" TEXT,
    "audioUrl" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "bytes" BIGINT,

    CONSTRAINT "AudioTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transcript" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "turns" JSONB,
    "roomChat" JSONB,
    "totalWords" INTEGER,
    "totalDurationSeconds" INTEGER,
    "mergedS3Url" TEXT,
    "cleanedS3Url" TEXT,
    "cleaningStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transcript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranscriptTrack" (
    "id" TEXT NOT NULL,
    "transcriptId" TEXT NOT NULL,
    "livekitIdentity" TEXT NOT NULL,
    "speakerName" TEXT NOT NULL,
    "participantId" TEXT,
    "trackStartedAt" TIMESTAMP(3) NOT NULL,
    "baseStartedAt" TIMESTAMP(3) NOT NULL,
    "transcriptText" TEXT NOT NULL,
    "durationSeconds" DOUBLE PRECISION NOT NULL,
    "words" JSONB NOT NULL,

    CONSTRAINT "TranscriptTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiResult" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "meetingType" "MeetingType" NOT NULL,
    "summary" TEXT NOT NULL,
    "structuredData" JSONB,
    "customOutputMd" TEXT,
    "followUpEmail" TEXT,
    "tasks" JSONB,
    "modelUsed" TEXT NOT NULL,
    "summaryV2" TEXT,
    "summaryV2Model" TEXT,
    "summaryV2GeneratedAt" TIMESTAMP(3),
    "summaryFast" TEXT,
    "summaryFastModel" TEXT,
    "summaryFastGeneratedAt" TIMESTAMP(3),
    "promptTemplateVersionId" TEXT,
    "experimentGroup" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsageLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "meetingId" TEXT,
    "userId" TEXT,
    "agentType" TEXT NOT NULL,
    "taskType" TEXT,
    "jobId" TEXT,
    "model" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "reasoningTokens" INTEGER,
    "costUsd" DECIMAL(10,6) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "errorText" TEXT,
    "sourceRef" JSONB,
    "experimentGroup" TEXT,
    "requestPreview" TEXT,
    "responsePreview" TEXT,
    "tier" TEXT,
    "fallbackReason" TEXT,
    "inputCostPerMillionTokensSnapshot" DECIMAL(10,6),
    "outputCostPerMillionTokensSnapshot" DECIMAL(10,6),
    "cachedCostPerMillionTokensSnapshot" DECIMAL(10,6),
    "currencyRateToUsdSnapshot" DECIMAL(12,6),
    "costRub" DECIMAL(14,4),
    "dataClassAudit" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationKey" (
    "id" TEXT NOT NULL,
    "partnerName" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "IntegrationKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookSeenEvent" (
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookSeenEvent_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "CrossmarkIdempotency" (
    "key" TEXT NOT NULL,
    "responseHash" TEXT NOT NULL,
    "responseBody" JSONB NOT NULL,
    "httpStatus" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrossmarkIdempotency_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "MeetingEvent" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordingAction" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordingAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "meetingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'open',
    "assigneeRaw" TEXT,
    "assigneeUserId" TEXT,
    "dueDate" TIMESTAMP(3),
    "sourceStartMs" INTEGER,
    "sourceEndMs" INTEGER,
    "sourceQuote" TEXT,
    "confidence" DOUBLE PRECISION,
    "createdManually" BOOLEAN NOT NULL DEFAULT false,
    "evidenceBlockIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "extractorVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingChapter" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "meetingId" TEXT NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "order" INTEGER NOT NULL,
    "evidenceBlockIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "extractorVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingChapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingHighlight" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "meetingId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "renderedMp4Key" TEXT,
    "renderStatus" "RenderStatus" NOT NULL DEFAULT 'none',
    "renderError" TEXT,
    "evidenceBlockId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingHighlight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingShare" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "allowVideo" BOOLEAN NOT NULL DEFAULT false,
    "allowTranscript" BOOLEAN NOT NULL DEFAULT false,
    "allowTasks" BOOLEAN NOT NULL DEFAULT true,
    "allowChapters" BOOLEAN NOT NULL DEFAULT true,
    "allowChat" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingShareView" (
    "id" TEXT NOT NULL,
    "shareId" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "referrer" TEXT,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingShareView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HighlightShare" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "highlightId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HighlightShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#888888',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingTag" (
    "meetingId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "MeetingTag_pkey" PRIMARY KEY ("meetingId","tagId")
);

-- CreateTable
CREATE TABLE "MeetingChatMessage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "meetingId" TEXT,
    "cardId" TEXT,
    "userId" TEXT NOT NULL,
    "role" "ChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "citations" JSONB,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "modelUsed" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingRoomMessage" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "participantId" TEXT,
    "authorName" TEXT NOT NULL,
    "authorIdentity" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "clientMessageId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingRoomMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingTranscriptChunk" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingTranscriptChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hashedKey" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scopes" "ApiKeyScope"[],
    "scope" TEXT NOT NULL DEFAULT 'api',
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookSubscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secretEncrypted" TEXT NOT NULL,
    "secretPrefix" TEXT NOT NULL,
    "events" TEXT[],
    "status" "WebhookStatus" NOT NULL DEFAULT 'active',
    "lastDeliveryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastStatus" INTEGER,
    "lastResponse" TEXT,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'pending',
    "nextAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationDestination" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT NOT NULL,
    "type" "DestinationType" NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationDestination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Export" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT NOT NULL,
    "type" "ExportType" NOT NULL,
    "meetingIds" TEXT[],
    "options" JSONB NOT NULL,
    "s3Key" TEXT,
    "status" "ExportStatus" NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Export_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "basedOnType" "MeetingType",
    "prompt" TEXT,
    "sectionsConfig" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmTaskRoute" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "taskType" TEXT NOT NULL,
    "providers" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "tier" "LlmRouteTier",
    "priority" INTEGER NOT NULL DEFAULT 0,
    "providerName" TEXT,
    "model" TEXT,
    "providerId" TEXT,
    "modelId" TEXT,
    "editedByAdmin" BOOLEAN NOT NULL DEFAULT false,
    "experiment" JSONB,
    "requiredDataClass" "DataClass",
    "pinnedVersionNote" TEXT,
    "evolutionEnabled" BOOLEAN NOT NULL DEFAULT true,
    "promptOverride" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlmTaskRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmTaskRouteChange" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "taskType" TEXT NOT NULL,
    "tier" "LlmRouteTier",
    "changeType" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "changedById" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmTaskRouteChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmModelExperiment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "taskType" TEXT NOT NULL,
    "controlModel" TEXT NOT NULL,
    "controlProvider" TEXT NOT NULL,
    "variantModel" TEXT NOT NULL,
    "variantProvider" TEXT NOT NULL,
    "splitPercent" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "startedAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "LlmModelExperiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "resourceId" TEXT,
    "metadata" JSONB,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "dataType" VARCHAR(60) NOT NULL,
    "consented" BOOLEAN NOT NULL,
    "policyVersion" VARCHAR(10) NOT NULL DEFAULT 'v1',
    "ipHash" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeAccessLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "viewerUserId" TEXT NOT NULL,
    "viewedPersonId" TEXT NOT NULL,
    "sectionAccessed" VARCHAR(60) NOT NULL,
    "ipHash" TEXT,
    "accessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiAccessLog" (
    "id" TEXT NOT NULL,
    "apiKeyId" TEXT,
    "userId" TEXT,
    "route" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserQuotaCounter" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "quotaName" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserQuotaCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "externalSource" TEXT,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'client',
    "color" TEXT NOT NULL DEFAULT '#5EEAD4',
    "icon" TEXT,
    "description" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "entityId" TEXT,
    "relatedEntityIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bornFromThemeId" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "summaryCache" TEXT,
    "summaryUpdatedAt" TIMESTAMP(3),
    "cachedTopThemeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceBlockIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" DECIMAL(4,3),
    "calibratedConfidence" DECIMAL(4,3),
    "dataClassAudit" JSONB,
    "currentVersionId" TEXT,
    "personSubjectIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastConfirmedAt" TIMESTAMP(3),
    "meetingCount" INTEGER NOT NULL DEFAULT 0,
    "lastMeetingAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Org" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "visibilityMode" "OrgVisibilityMode" NOT NULL DEFAULT 'open',
    "tier" "OrgTier" NOT NULL DEFAULT 'basic',
    "workersEnabled" JSONB NOT NULL DEFAULT '{}',
    "strategicAlignmentWindowDays" INTEGER NOT NULL DEFAULT 30,
    "transcriptCleaningAuto" BOOLEAN NOT NULL DEFAULT false,
    "qualityScoreDisabledForTypes" "MeetingType"[] DEFAULT ARRAY[]::"MeetingType"[],
    "timezone" TEXT DEFAULT 'Europe/Moscow',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "teamSize" VARCHAR(20),
    "industry" VARCHAR(60),
    "painPoints" TEXT[],
    "currentStack" TEXT[],
    "plannedFeatures" TEXT[],
    "welcomeCompletedAt" TIMESTAMP(3),
    "region" VARCHAR(10) DEFAULT 'ru',
    "companyInfoCompletedAt" TIMESTAMP(3),
    "departmentsCompletedAt" TIMESTAMP(3),
    "rolesCompletedAt" TIMESTAMP(3),
    "teamInvitedAt" TIMESTAMP(3),
    "firstSprintCreatedAt" TIMESTAMP(3),
    "firstMeetingCreatedAt" TIMESTAMP(3),
    "setupCompletedAt" TIMESTAMP(3),
    "demoWorkspaceSeededAt" TIMESTAMP(3),
    "demoUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isReferenceDemo" BOOLEAN NOT NULL DEFAULT false,
    "curationSettings" JSONB,
    "inn" VARCHAR(20),
    "ogrn" VARCHAR(20),
    "kpp" VARCHAR(20),
    "directorName" VARCHAR(255),
    "legalAddress" TEXT,
    "bankBik" VARCHAR(9),
    "bankAccount" VARCHAR(20),
    "bankCorrAccount" VARCHAR(20),
    "bankName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "billingDetailsVersion" INTEGER NOT NULL DEFAULT 1,
    "pendingAttributionSlug" TEXT,
    "pendingAttributionAt" TIMESTAMP(3),

    CONSTRAINT "Org_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "invitedBy" TEXT,
    "personId" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloneAccessGrant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "grantedToUserId" TEXT NOT NULL,
    "cloneType" TEXT NOT NULL,
    "cloneRefId" TEXT NOT NULL,
    "grantedById" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "expiresAt" TIMESTAMP(3),
    "externalSource" TEXT,

    CONSTRAINT "CloneAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgInvitation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT,
    "role" "MembershipRole" NOT NULL,
    "token" TEXT NOT NULL,
    "status" "OrgInvitationStatus" NOT NULL DEFAULT 'pending',
    "invitedBy" TEXT NOT NULL,
    "personId" TEXT,
    "linkCode" TEXT,
    "linkCodeUsedAt" TIMESTAMP(3),
    "magicTokenHash" TEXT,
    "magicTokenUsedAt" TIMESTAMP(3),
    "tempPasswordHash" TEXT,
    "reminderSentAt" TIMESTAMP(3),
    "directorNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedByUserId" TEXT,

    CONSTRAINT "OrgInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeCapabilityOverride" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "grantedToUserId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "effect" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "grantedById" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,

    CONSTRAINT "EmployeeCapabilityOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmModelPrice" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "modelId" TEXT,
    "inputCostPerMillionTokens" DECIMAL(10,6) NOT NULL,
    "outputCostPerMillionTokens" DECIMAL(10,6) NOT NULL,
    "cachedCostPerMillionTokens" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "inputCachedWritePerMillionTokens" DECIMAL(10,6),
    "currencyRateToUsdSnapshot" DECIMAL(12,6),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "changedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmModelPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_providers" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "displayName" VARCHAR(120) NOT NULL,
    "baseUrl" VARCHAR(500) NOT NULL,
    "protocolKind" VARCHAR(40) NOT NULL,
    "capability" VARCHAR(20) NOT NULL DEFAULT 'public',
    "apiKeyEncrypted" TEXT,
    "defaultHeaders" JSONB,
    "globalRps" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSmokeAt" TIMESTAMP(3),
    "lastSmokeSuccess" BOOLEAN,
    "lastSmokeError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "llm_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_models" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "modelKey" VARCHAR(120) NOT NULL,
    "displayName" VARCHAR(200) NOT NULL,
    "contextWindow" INTEGER,
    "capabilitiesJson" JSONB,
    "category" VARCHAR(40),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "verifiedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "llm_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_cost_daily" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "taskType" VARCHAR(80) NOT NULL,
    "provider" VARCHAR(60) NOT NULL,
    "model" VARCHAR(120) NOT NULL,
    "callsCount" INTEGER NOT NULL DEFAULT 0,
    "callsSuccess" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "costRub" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "recalculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_cost_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_budget_caps" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "monthlyCapRub" DECIMAL(14,2),
    "capKind" VARCHAR(10) NOT NULL DEFAULT 'soft',
    "alertThresholds" INTEGER[] DEFAULT ARRAY[50, 80, 95]::INTEGER[],
    "lastAlertAt" TIMESTAMP(3),
    "lastAlertThreshold" INTEGER,
    "setByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_budget_caps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currency_rates" (
    "id" TEXT NOT NULL,
    "baseCurrency" VARCHAR(3) NOT NULL,
    "quoteCurrency" VARCHAR(3) NOT NULL,
    "rate" DECIMAL(14,6) NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'cbr',
    "rateDate" DATE NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "currency_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "SourceType" NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB,
    "dataClass" "DataClass" NOT NULL DEFAULT 'internal',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "sourceExternalId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payloadStorage" "RawEventPayloadStorage" NOT NULL DEFAULT 'inline',
    "payload" JSONB,
    "payloadS3Key" TEXT,
    "payloadChecksum" TEXT NOT NULL,
    "payloadSizeBytes" INTEGER NOT NULL,
    "dataClass" "DataClass" NOT NULL DEFAULT 'internal',
    "processingStatus" "RawEventProcessingStatus" NOT NULL DEFAULT 'received',
    "processingError" TEXT,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "RawEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdeaBlock" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalSource" TEXT,
    "name" TEXT NOT NULL,
    "criticalQuestion" TEXT NOT NULL,
    "trustedAnswer" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "signalType" "SignalType" NOT NULL,
    "confidence" DECIMAL(4,3) NOT NULL DEFAULT 0.5,
    "dataClass" "DataClass" NOT NULL DEFAULT 'internal',
    "embedding" vector(1536),
    "status" "IdeaBlockStatus" NOT NULL DEFAULT 'draft',
    "mergedIntoId" TEXT,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "dynamicScore" DECIMAL(8,4) NOT NULL DEFAULT 1.0,
    "roleRelevant" BOOLEAN NOT NULL DEFAULT false,
    "roleId" TEXT,
    "commitmentDueDate" TIMESTAMP(3),
    "commitmentStatus" VARCHAR(20),
    "commitmentRecipientPersonId" TEXT,
    "commitmentAskedAt" TIMESTAMP(3),
    "commitmentEscalatedAt" TIMESTAMP(3),
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),
    "supersededById" TEXT,
    "propertySpans" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdeaBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdeaBlockAxisLabel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "axis" "AxisType" NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "confidence" DECIMAL(4,3) NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdeaBlockAxisLabel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdeaBlockEvidence" (
    "id" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "rawEventId" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "sourceTimestamp" TIMESTAMP(3),
    "quote" TEXT NOT NULL,
    "startMs" INTEGER,
    "endMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdeaBlockEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalSource" TEXT,
    "type" "EntityType" NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mergedIntoId" TEXT,
    "mentionsCount" INTEGER NOT NULL DEFAULT 0,
    "embedding" vector(1536),
    "metadata" JSONB,
    "inn" VARCHAR(20),
    "ogrn" VARCHAR(20),
    "email" VARCHAR(320),
    "phone" VARCHAR(40),
    "domain" VARCHAR(253),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "inn" VARCHAR(20),
    "segment" "VendorSegment",
    "status" "VendorStatus" NOT NULL DEFAULT 'active',
    "responsibleUserId" TEXT,
    "contractIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "kind" "EventKind" NOT NULL DEFAULT 'other',
    "title" VARCHAR(300) NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "durationMin" INTEGER,
    "location" VARCHAR(300),
    "participantsPersonIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "relatedMeetingId" TEXT,
    "outcomeSummary" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "ownerId" TEXT,
    "description" TEXT,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Europe/Moscow',
    "rrule" TEXT,
    "status" "EventStatus" NOT NULL DEFAULT 'confirmed',
    "visibility" "EventVisibility" NOT NULL DEFAULT 'company',
    "externalProvider" VARCHAR(40),
    "externalEventId" VARCHAR(200),
    "projectId" TEXT,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventParticipant" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT,
    "personId" TEXT,
    "role" "EventParticipantRole" NOT NULL DEFAULT 'required',
    "rsvp" "RsvpStatus" NOT NULL DEFAULT 'pending',
    "rsvpAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventReminder" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "offsetMin" INTEGER NOT NULL,
    "channel" "ReminderChannel" NOT NULL,
    "userId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Market" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "geography" VARCHAR(120),
    "industry" VARCHAR(120),
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Market_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgUnit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "unitKind" VARCHAR(40) NOT NULL,
    "parentDepartmentId" TEXT,
    "leadUserId" TEXT,
    "memberPersonIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "OrgUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurationItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "resourceType" VARCHAR(80) NOT NULL,
    "resourceId" VARCHAR(80) NOT NULL,
    "level" "CurationLevel" NOT NULL,
    "triageReason" JSONB NOT NULL,
    "proposedPayload" JSONB NOT NULL,
    "status" "CurationItemStatus" NOT NULL DEFAULT 'pending',
    "assignedToUserId" TEXT,
    "candidateCuratorIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "CurationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurationDecision" (
    "id" TEXT NOT NULL,
    "curationItemId" TEXT NOT NULL,
    "decisionType" "CurationDecisionType" NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "reasoning" TEXT,
    "reviewerUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CurationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingActionSnooze" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" VARCHAR(40) NOT NULL,
    "resourceType" VARCHAR(80) NOT NULL,
    "resourceId" VARCHAR(80) NOT NULL,
    "snoozedUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingActionSnooze_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConflictItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "resourceType" VARCHAR(80) NOT NULL,
    "existingId" VARCHAR(80) NOT NULL,
    "newId" VARCHAR(80) NOT NULL,
    "evidence" JSONB NOT NULL,
    "relationType" VARCHAR(40) NOT NULL,
    "detectedBy" VARCHAR(40) NOT NULL,
    "status" "ConflictStatus" NOT NULL DEFAULT 'open',
    "resolution" "ConflictResolution",
    "evolvingMeta" JSONB,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "reasoning" TEXT,
    "dataClassAudit" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConflictItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "resourceType" VARCHAR(80) NOT NULL,
    "resourceId" VARCHAR(80) NOT NULL,
    "version" INTEGER NOT NULL,
    "previousVersionId" TEXT,
    "payload" JSONB NOT NULL,
    "changeReason" VARCHAR(40),
    "createdByUserId" TEXT,
    "curationDecisionId" TEXT,
    "curationItemId" TEXT,
    "trustTier" "TrustTier" NOT NULL DEFAULT 'human',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CuratorAssignment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "resourceType" VARCHAR(80) NOT NULL,
    "criteria" JSONB,
    "curatorUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "level" "CurationLevel",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CuratorAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "completeness_slots" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "parentCardType" VARCHAR(40) NOT NULL,
    "parentCardId" VARCHAR(80) NOT NULL,
    "slotName" VARCHAR(80) NOT NULL,
    "slotKind" VARCHAR(20) NOT NULL,
    "filledAt" TIMESTAMP(3),
    "filledByUserId" TEXT,
    "lastProbedAt" TIMESTAMP(3),
    "probeAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "completeness_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdeaBlockEntity" (
    "blockId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "mentionContext" TEXT NOT NULL,
    "role" "IdeaBlockEntityRole" NOT NULL DEFAULT 'mentioned',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdeaBlockEntity_pkey" PRIMARY KEY ("blockId","entityId")
);

-- CreateTable
CREATE TABLE "IdeaBlockLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fromBlockId" TEXT NOT NULL,
    "toBlockId" TEXT NOT NULL,
    "relationType" "IdeaBlockLinkType" NOT NULL,
    "confidence" DECIMAL(4,3) NOT NULL,
    "explanation" TEXT NOT NULL,
    "createdBy" "LinkCreatedBy" NOT NULL,
    "status" "LinkStatus" NOT NULL DEFAULT 'active',
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "validFrom" TIMESTAMPTZ,
    "validUntil" TIMESTAMPTZ,

    CONSTRAINT "IdeaBlockLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fromEntityId" TEXT NOT NULL,
    "toEntityId" TEXT NOT NULL,
    "fromType" VARCHAR(50),
    "toType" VARCHAR(50),
    "relationType" "EntityLinkType" NOT NULL,
    "confidence" DECIMAL(4,3) NOT NULL,
    "explanation" TEXT NOT NULL,
    "createdBy" "LinkCreatedBy" NOT NULL,
    "status" "LinkStatus" NOT NULL DEFAULT 'active',
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "properties" JSONB NOT NULL DEFAULT '{}',
    "attributes" JSONB,
    "sourceBlockIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EntityLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Theme" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalSource" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "weight" DECIMAL(4,3) NOT NULL DEFAULT 0.5,
    "dynamic" "ThemeDynamic" NOT NULL DEFAULT 'stable',
    "confidence" DECIMAL(4,3) NOT NULL DEFAULT 0.5,
    "status" "ThemeStatus" NOT NULL DEFAULT 'active',
    "mergedIntoId" TEXT,
    "branch" "ThemeBranch",
    "embedding" vector(1536),
    "lastSignalAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Theme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThemeIdeaBlock" (
    "themeId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "weight" DECIMAL(4,3) NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThemeIdeaBlock_pkey" PRIMARY KEY ("themeId","blockId")
);

-- CreateTable
CREATE TABLE "ThemeEntity" (
    "themeId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "mentionsCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThemeEntity_pkey" PRIMARY KEY ("themeId","entityId")
);

-- CreateTable
CREATE TABLE "SuperAdminAccessLog" (
    "id" TEXT NOT NULL,
    "superAdminUserId" TEXT NOT NULL,
    "accessedTenantId" TEXT,
    "route" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "params" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuperAdminAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalSource" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "targetDate" TIMESTAMP(3),
    "status" "GoalStatus" NOT NULL DEFAULT 'active',
    "weight" DECIMAL(4,3) NOT NULL DEFAULT 1.0,
    "horizon" "GoalHorizon" NOT NULL DEFAULT 'quarterly',
    "parentGoalId" TEXT,
    "cascadeMissed" BOOLEAN NOT NULL DEFAULT false,
    "cascadeMissedFromGoalId" TEXT,
    "cascadeMissedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "cachedAlignment" INTEGER,
    "cachedAlignmentAt" TIMESTAMP(3),
    "cachedAlignmentDelta" INTEGER,
    "cachedSnapshotId" TEXT,
    "entityId" TEXT,
    "source" "GoalSource" NOT NULL DEFAULT 'manual',
    "promotionState" "GoalPromotionState" NOT NULL DEFAULT 'active',
    "progressStatus" "GoalProgressStatus" NOT NULL DEFAULT 'on_track',
    "sourceBlockIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" DECIMAL(4,3),
    "manualOverride" JSONB NOT NULL DEFAULT '{}',
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededById" TEXT,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalTheme" (
    "goalId" TEXT NOT NULL,
    "themeId" TEXT NOT NULL,
    "source" "GoalThemeSource" NOT NULL DEFAULT 'manual',
    "weight" DECIMAL(4,3) NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoalTheme_pkey" PRIMARY KEY ("goalId","themeId")
);

-- CreateTable
CREATE TABLE "GoalAlignmentSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "delta" INTEGER,
    "explanation" TEXT NOT NULL,
    "signals" JSONB NOT NULL,
    "windowDays" INTEGER NOT NULL DEFAULT 30,
    "themesCount" INTEGER NOT NULL,
    "blocksCount" INTEGER NOT NULL,
    "aiUsageLogId" TEXT,
    "alertPending" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "externalSource" TEXT,

    CONSTRAINT "GoalAlignmentSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalKeyResult" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "startValue" DECIMAL(18,4) NOT NULL,
    "targetValue" DECIMAL(18,4) NOT NULL,
    "currentValue" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "sourceKind" "GoalKrSourceKind" NOT NULL DEFAULT 'manual',
    "sourceConfig" JSONB NOT NULL DEFAULT '{}',
    "source" "GoalSource" NOT NULL DEFAULT 'manual',
    "manualOverride" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoalKeyResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalKeyResultCheckpoint" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "keyResultId" TEXT NOT NULL,
    "value" DECIMAL(18,4) NOT NULL,
    "recordedBy" TEXT NOT NULL DEFAULT 'auto',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoalKeyResultCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_goals_pulse_digests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "isoWeek" VARCHAR(10) NOT NULL,
    "bodyMarkdown" TEXT NOT NULL,
    "metricsJson" JSONB NOT NULL,
    "llmTaskRouteId" TEXT,
    "shortSummary" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "externalSource" TEXT,

    CONSTRAINT "weekly_goals_pulse_digests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgRetentionPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "rawEventDays" INTEGER NOT NULL DEFAULT 2555,
    "archivedBlockDays" INTEGER NOT NULL DEFAULT 365,
    "chatMessageDays" INTEGER NOT NULL DEFAULT 90,
    "auditLogDays" INTEGER NOT NULL DEFAULT 730,
    "archivedBlockAction" TEXT NOT NULL DEFAULT 'archive_then_delete',
    "lastSweepAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgRetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgEntitlement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'tier_pro',
    "featureOverrides" JSONB,
    "quotaOverrides" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalSource" TEXT,
    "name" VARCHAR(200) NOT NULL,
    "parentDepartmentId" TEXT,
    "missionStatement" TEXT,
    "completeness" DECIMAL(4,3),
    "entityId" TEXT,
    "sourceBlockIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" DECIMAL(4,3),
    "headPersonId" TEXT,
    "healthSummaryJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalSource" TEXT,
    "name" VARCHAR(200) NOT NULL,
    "departmentId" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "missionStatement" TEXT,
    "maturityScore" DECIMAL(4,3),
    "entityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "persons" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalSource" TEXT,
    "userId" TEXT,
    "name" VARCHAR(200) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "primaryDepartmentId" TEXT,
    "entityId" TEXT,
    "relationship" "PersonRelationship" NOT NULL DEFAULT 'external',
    "knowledgeProfile" JSONB,
    "lastProfileBuildAt" TIMESTAMP(3),
    "profileBuildVersion" INTEGER NOT NULL DEFAULT 0,
    "timezone" VARCHAR(64) DEFAULT 'Europe/Moscow',
    "engagementScore" DECIMAL(4,3),
    "engagementScoreAt" TIMESTAMP(3),
    "hrSuggestionsJson" JSONB,
    "riskFlagsJson" JSONB,
    "analyticsOptIn" BOOLEAN NOT NULL DEFAULT false,
    "analyticsOptInAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person_knowledge_category_embeddings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "categoryName" VARCHAR(200) NOT NULL,
    "confidence" VARCHAR(16) NOT NULL,
    "embedding" vector(1536),
    "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "profileBuildVersion" INTEGER NOT NULL,

    CONSTRAINT "person_knowledge_category_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person_roles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "person_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalSource" TEXT,
    "personId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "departmentId" TEXT,
    "loadPercent" INTEGER NOT NULL DEFAULT 100,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "sourceBlockIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" DECIMAL(4,3) NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_descriptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "contentMd" TEXT NOT NULL,
    "sourceDocumentId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "job_descriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skills" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "s3Key" VARCHAR(500),
    "inlineContent" BYTEA,
    "originalSize" INTEGER NOT NULL,
    "parsedText" TEXT,
    "parseError" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'uploaded',
    "attachedRoleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "entityId" TEXT,
    "useCases" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_voice_profiles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "toneJson" JSONB,
    "valuesJson" JSONB,
    "taboosJson" JSONB,
    "exampleArtifactIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastBuiltAt" TIMESTAMP(3),
    "builderAgentVersion" VARCHAR(40),
    "completeness" DECIMAL(4,3) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_voice_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_profiles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "summaryCache" JSONB NOT NULL DEFAULT '{}',
    "status" "RoleProfileStatus" NOT NULL DEFAULT 'forming',
    "lastBuildAt" TIMESTAMP(3),
    "buildVersion" INTEGER NOT NULL DEFAULT 0,
    "builtAt" TIMESTAMP(3),
    "builderAgentVersion" VARCHAR(40),
    "observationCount" INTEGER NOT NULL DEFAULT 0,
    "completeness" DECIMAL(4,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "responsibility_elements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "parentId" TEXT,
    "kind" VARCHAR(20) NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "sourceBlockIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" DECIMAL(4,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "responsibility_elements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authority_boundaries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "scope" TEXT NOT NULL,
    "approverRoleId" TEXT,
    "thresholdsJson" JSONB,
    "sourceBlockIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" DECIMAL(4,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "authority_boundaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "required_knowledge" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "topic" VARCHAR(300) NOT NULL,
    "description" TEXT,
    "importance" VARCHAR(20) NOT NULL,
    "expectedLevel" VARCHAR(20),
    "sourceBlockIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" DECIMAL(4,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "required_knowledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_policies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "conditionDescription" TEXT,
    "ruleDescription" TEXT NOT NULL,
    "regulationId" TEXT,
    "sourceBlockIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" DECIMAL(4,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "decision_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interactions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "counterpartRoleId" TEXT,
    "counterpartDepartmentId" TEXT,
    "counterpartExternal" VARCHAR(300),
    "kind" VARCHAR(40) NOT NULL,
    "frequency" VARCHAR(20),
    "description" TEXT,
    "sourceBlockIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" DECIMAL(4,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "missions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contentMd" TEXT NOT NULL,
    "markets" JSONB,
    "bets" JSONB,
    "horizon" "GoalHorizon" NOT NULL DEFAULT 'strategic',
    "targetDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "missions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contentMd" TEXT NOT NULL,
    "horizonYears" INTEGER,
    "targetDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contentMd" TEXT NOT NULL,
    "markets" JSONB NOT NULL DEFAULT '[]',
    "bets" JSONB NOT NULL DEFAULT '[]',
    "horizon" "GoalHorizon" NOT NULL DEFAULT 'strategic',
    "targetDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_profiles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalSource" TEXT,
    "displayName" VARCHAR(300),
    "missionJson" JSONB,
    "visionJson" JSONB,
    "strategyJson" JSONB,
    "targetMarketIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maturityScore" DECIMAL(4,3),
    "lastMaturityCalcAt" TIMESTAMP(3),
    "stage" VARCHAR(40),
    "sourceBlockIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" DECIMAL(4,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "functional_domains" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalSource" TEXT,
    "parentDomainId" TEXT,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "iconName" VARCHAR(60),
    "slug" VARCHAR(80) NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "completeness" DECIMAL(4,3),
    "order" INTEGER NOT NULL DEFAULT 0,
    "confidence" DECIMAL(4,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "functional_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department_domain_links" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "coverageRatio" DECIMAL(4,3),
    "role" VARCHAR(20) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "department_domain_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalSource" TEXT,
    "name" VARCHAR(300) NOT NULL,
    "description" TEXT,
    "ownerRoleId" TEXT,
    "ownerPersonId" TEXT,
    "triggerDescription" TEXT,
    "slaMinutes" INTEGER,
    "status" "ProcessStatus" NOT NULL DEFAULT 'active',
    "confidence" DOUBLE PRECISION,
    "ambiguousTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "entityId" TEXT,
    "scope" VARCHAR(120),
    "currentVersionId" TEXT,
    "sourceBlockIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "personSubjectIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dataClass" "DataClass" NOT NULL DEFAULT 'internal',
    "embedding" vector(1536),
    "lastConfirmedAt" TIMESTAMP(3),
    "inputs" JSONB,
    "outputs" JSONB,
    "metricsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "templateId" TEXT,

    CONSTRAINT "processes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "summary" TEXT,
    "category" VARCHAR(60),
    "scope" VARCHAR(120),
    "status" "ProcessStatus" NOT NULL DEFAULT 'active',
    "currentVersionId" TEXT,
    "ownerRoleId" TEXT,
    "ownerPersonId" TEXT,
    "sourceBlockIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dataClass" "DataClass" NOT NULL DEFAULT 'internal',
    "embedding" vector(1536),
    "lastConfirmedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "isCrossFunctional" BOOLEAN NOT NULL DEFAULT false,
    "crossFunctionalScore" DECIMAL(4,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "process_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cross_functional_friction_reports" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "processTemplateId" TEXT NOT NULL,
    "severity" VARCHAR(20) NOT NULL,
    "description" TEXT NOT NULL,
    "sourceBlockIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "involvedDepartmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recommendedAction" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cross_functional_friction_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_template_versions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "definitionJson" JSONB NOT NULL,
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "source" VARCHAR(40) NOT NULL,
    "changeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "process_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_points" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "templateId" TEXT,
    "processStepId" TEXT,
    "name" VARCHAR(300) NOT NULL,
    "condition" TEXT,
    "branchesJson" JSONB NOT NULL,
    "decidedByRoleId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "decision_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_handoffs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fromTemplateId" TEXT,
    "fromProcessStepId" TEXT,
    "fromRoleId" TEXT,
    "toTemplateId" TEXT,
    "toProcessStepId" TEXT,
    "toRoleId" TEXT,
    "kind" VARCHAR(40) NOT NULL,
    "payloadDescription" TEXT,
    "expectedSlaHours" INTEGER,
    "knownFrictionCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "process_handoffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_steps" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalSource" TEXT,
    "processId" TEXT NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "order" INTEGER NOT NULL,
    "description" TEXT,
    "slaMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "process_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regulations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "contentMd" TEXT NOT NULL,
    "category" "RegulationCategory" NOT NULL DEFAULT 'regulation',
    "status" "ProcessStatus" NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "confidence" DOUBLE PRECISION,
    "entityId" TEXT,
    "statement" TEXT,
    "scope" VARCHAR(120),
    "ownerPersonId" TEXT,
    "supersedesId" TEXT,
    "currentVersionId" TEXT,
    "sourceBlockIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "personSubjectIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dataClass" "DataClass" NOT NULL DEFAULT 'internal',
    "embedding" vector(1536),
    "lastConfirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regulations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "contentMd" TEXT NOT NULL,
    "severity" "PolicySeverity" NOT NULL DEFAULT 'advisory',
    "status" "ProcessStatus" NOT NULL DEFAULT 'active',
    "confidence" DOUBLE PRECISION,
    "entityId" TEXT,
    "scope" VARCHAR(120),
    "ownerPersonId" TEXT,
    "currentVersionId" TEXT,
    "sourceBlockIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "personSubjectIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dataClass" "DataClass" NOT NULL DEFAULT 'internal',
    "embedding" vector(1536),
    "lastConfirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tools" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "kind" "ToolKind" NOT NULL DEFAULT 'software',
    "externalUrl" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metrics" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "unit" VARCHAR(50) NOT NULL,
    "target" DOUBLE PRECISION,
    "valueType" "MetricValueType" NOT NULL DEFAULT 'count',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "attachedToResponsibilityElementId" TEXT,
    "attachedToRoleId" TEXT,
    "attachedToDepartmentId" TEXT,
    "currentValue" DECIMAL(18,4),
    "currentValueUnit" VARCHAR(50),
    "lastMeasuredAt" TIMESTAMP(3),
    "frequency" VARCHAR(20),

    CONSTRAINT "metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decisions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalSource" TEXT,
    "text" TEXT,
    "decidedByPersonId" TEXT,
    "sourceMeetingId" TEXT,
    "sourceIdeaBlockId" TEXT,
    "entityId" TEXT,
    "statement" TEXT,
    "rationale" TEXT,
    "alternatives" JSONB,
    "decidedByPersonIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "decidedAt" TIMESTAMP(3),
    "deadline" TIMESTAMP(3),
    "supersedesId" TEXT,
    "affectsEntityIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceBlockIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "personSubjectIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" DECIMAL(4,3),
    "dataClass" "DataClass" NOT NULL DEFAULT 'sensitive',
    "dataClassAudit" JSONB,
    "currentVersionId" TEXT,
    "embedding" vector(1536),
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "actualOutcomes" TEXT,
    "appliedPolicyId" TEXT,
    "status" "DecisionStatus" NOT NULL DEFAULT 'approved',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastConfirmedAt" TIMESTAMP(3),
    "raisedCount" INTEGER NOT NULL DEFAULT 1,
    "lastRaisedAt" TIMESTAMP(3),
    "reversibility" TEXT,
    "reversibilityAt" TIMESTAMP(3),

    CONSTRAINT "decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insights" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalSource" TEXT,
    "entityId" TEXT,
    "kind" "InsightKind" NOT NULL,
    "statement" TEXT NOT NULL,
    "severity" "InsightSeverity" NOT NULL DEFAULT 'medium',
    "frequencyScore" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "dynamicScore" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "dynamicLabel" "InsightDynamic" NOT NULL DEFAULT 'stable',
    "affectedEntityIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "relatedDecisionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mitigationPlan" TEXT,
    "causeCategory" VARCHAR(40),
    "firstObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "InsightStatus" NOT NULL DEFAULT 'active',
    "sourceBlockIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "personSubjectIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" DECIMAL(4,3) NOT NULL DEFAULT 0.5,
    "dataClass" "DataClass" NOT NULL DEFAULT 'internal',
    "dataClassAudit" JSONB,
    "currentVersionId" TEXT,
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastConfirmedAt" TIMESTAMP(3),

    CONSTRAINT "insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ideas" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entityId" TEXT,
    "kind" "IdeaKind" NOT NULL,
    "statement" TEXT NOT NULL,
    "rationale" TEXT,
    "weight" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "supporterCount" INTEGER NOT NULL DEFAULT 1,
    "supporters" JSONB NOT NULL DEFAULT '[]',
    "firstProposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDiscussedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "IdeaStatus" NOT NULL DEFAULT 'captured',
    "statusChangedAt" TIMESTAMP(3),
    "statusChangedByUserId" TEXT,
    "statusReason" TEXT,
    "clusterId" TEXT,
    "sourceBlockIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "personSubjectIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" DECIMAL(4,3) NOT NULL DEFAULT 0.5,
    "dataClass" "DataClass" NOT NULL DEFAULT 'internal',
    "currentVersionId" TEXT,
    "embedding" vector(1536),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "goalId" TEXT,

    CONSTRAINT "ideas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idea_clusters" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ideaIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "clusterWeight" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idea_clusters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "probe_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "emittedByService" VARCHAR(80) NOT NULL,
    "reason" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "recipientCandidates" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "selectedRecipientId" TEXT,
    "status" "ProbeStatus" NOT NULL DEFAULT 'pending',
    "dispatchedNotificationId" TEXT,
    "contentHash" VARCHAR(80) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 50,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "dataClassAudit" JSONB,

    CONSTRAINT "probe_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptTemplate" (
    "id" TEXT NOT NULL,
    "scope" "PromptTemplateScope" NOT NULL,
    "orgId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "meetingType" "MeetingType",
    "taskType" TEXT NOT NULL,
    "status" "PromptTemplateStatus" NOT NULL DEFAULT 'draft',
    "activeVersionId" TEXT,
    "editedByAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptTemplateVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "outputSchema" JSONB NOT NULL,
    "toolName" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "PromptTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptTemplateSection" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "outputType" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "maxTokens" INTEGER,

    CONSTRAINT "PromptTemplateSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptExperiment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "templateAId" TEXT NOT NULL,
    "templateBId" TEXT NOT NULL,
    "splitPercent" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "startedAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "PromptExperiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiResultFeedback" (
    "id" TEXT NOT NULL,
    "aiResultId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reaction" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiResultFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingReport" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "promptTemplateId" TEXT NOT NULL,
    "promptTemplateVersionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'additional',
    "title" TEXT NOT NULL,
    "status" "MeetingReportStatus" NOT NULL DEFAULT 'pending',
    "output" JSONB,
    "llmCostUsd" DECIMAL(10,4),
    "llmDurationMs" INTEGER,
    "errorMessage" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MeetingReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channels" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "kind" "ChannelKind" NOT NULL,
    "direction" "ChannelDirection" NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "status" "ChannelStatus" NOT NULL DEFAULT 'active',
    "maxDataClass" "DataClass" NOT NULL DEFAULT 'internal',
    "brokenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_bindings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "maxDataClass" "DataClass" NOT NULL DEFAULT 'internal',
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "channel_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalSource" TEXT,
    "recipientUserId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dataClass" "DataClass" NOT NULL DEFAULT 'internal',
    "contextBlockId" TEXT,
    "contextCardId" TEXT,
    "status" "NotificationStatus" NOT NULL DEFAULT 'queued',
    "responseStatus" "NotificationResponseStatus",
    "responsePayload" JSONB,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "channelBindingId" TEXT NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'queued',
    "externalMessageId" TEXT,
    "errorReason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_check_ins" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "dateLocal" VARCHAR(10) NOT NULL,
    "plansJson" JSONB,
    "donesJson" JSONB,
    "blockersJson" JSONB,
    "notificationId" TEXT,
    "rawResponseText" TEXT,
    "parseConfidence" DECIMAL(4,3),
    "curatorReview" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "source" "DailyCheckInSource" NOT NULL DEFAULT 'cron_prompted',
    "sentiment" VARCHAR(10),
    "sentimentRationale" TEXT,
    "sentimentVersion" VARCHAR(120),
    "sentimentDeterminedAt" TIMESTAMP(3),
    "qualityScore" DECIMAL(4,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "externalSource" TEXT,

    CONSTRAINT "daily_check_ins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person_engagement_snapshots" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "score" DECIMAL(4,3) NOT NULL,
    "signalsJson" JSONB NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "person_engagement_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forecast_snapshots" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scope" VARCHAR(16) NOT NULL,
    "scopeId" TEXT,
    "payloadJson" JSONB NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forecast_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_risk_snapshots" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "categoryName" VARCHAR(200) NOT NULL,
    "highConfidenceCount" INTEGER NOT NULL,
    "totalExpertsCount" INTEGER NOT NULL,
    "riskLevel" VARCHAR(16) NOT NULL,
    "topExpertsJson" JSONB NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_risk_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_topics" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "themeId" TEXT,
    "themeName" VARCHAR(500) NOT NULL,
    "mentionCount" INTEGER NOT NULL,
    "meetingCount" INTEGER NOT NULL,
    "hasImplementedDecision" BOOLEAN NOT NULL,
    "blockIdsJson" JSONB NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recurring_topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promise_network_snapshots" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "graphJson" JSONB NOT NULL,
    "totalCommitments" INTEGER NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promise_network_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person_goal_contributions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "proScore" DECIMAL(8,3) NOT NULL,
    "contraScore" DECIMAL(8,3) NOT NULL,
    "netScore" DECIMAL(8,3) NOT NULL,
    "signalsJson" JSONB NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "person_goal_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_velocity_snapshots" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "medianHoursToAnswer" DECIMAL(10,2),
    "resolvedGapsCount" INTEGER NOT NULL,
    "openGapsCount" INTEGER NOT NULL,
    "topRespondersJson" JSONB NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_velocity_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_operations_digests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "weekStart" VARCHAR(10) NOT NULL,
    "weekEnd" VARCHAR(10) NOT NULL,
    "bodyMarkdown" TEXT NOT NULL,
    "metricsJson" JSONB NOT NULL,
    "sourcesJson" JSONB NOT NULL,
    "llmTaskRouteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "externalSource" TEXT,

    CONSTRAINT "weekly_operations_digests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_operations_digests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dateLocal" VARCHAR(10) NOT NULL,
    "bodyMarkdown" TEXT NOT NULL,
    "metricsJson" JSONB NOT NULL,
    "sourcesJson" JSONB NOT NULL,
    "llmTaskRouteId" TEXT,
    "shortSummary" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "externalSource" TEXT,

    CONSTRAINT "daily_operations_digests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proactive_notifications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ruleType" VARCHAR(60) NOT NULL,
    "severity" VARCHAR(10) NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "notificationId" TEXT,
    "emittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "proactive_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingBehaviorMetrics" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "totalDurationMs" INTEGER NOT NULL,
    "totalSpeechMs" INTEGER NOT NULL,
    "silenceMs" INTEGER NOT NULL,
    "silencePercent" DOUBLE PRECISION NOT NULL,
    "crossTalkMs" INTEGER NOT NULL,
    "dominanceIndex" DOUBLE PRECISION NOT NULL,
    "diarizationConfidence" DOUBLE PRECISION NOT NULL,
    "lowConfidence" BOOLEAN NOT NULL DEFAULT false,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingBehaviorMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingParticipantBehavior" (
    "id" TEXT NOT NULL,
    "meetingBehaviorMetricsId" TEXT NOT NULL,
    "participantId" TEXT,
    "tenantId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "isGuest" BOOLEAN NOT NULL DEFAULT false,
    "speakingTimeMs" INTEGER NOT NULL,
    "speakingTimePercent" DOUBLE PRECISION NOT NULL,
    "turnsCount" INTEGER NOT NULL,
    "avgTurnDurationMs" DOUBLE PRECISION NOT NULL,
    "monologueCount" INTEGER NOT NULL,
    "longestMonologueMs" INTEGER NOT NULL,
    "questionCount" INTEGER NOT NULL,
    "fillerWordsCount" INTEGER NOT NULL,
    "interruptionsMadeCount" INTEGER NOT NULL,
    "interruptionsReceivedCount" INTEGER NOT NULL,
    "sentimentTextPerSpeakerJson" JSONB,

    CONSTRAINT "MeetingParticipantBehavior_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingQualityScore" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "overallScore" INTEGER NOT NULL,
    "preparationScore" INTEGER NOT NULL,
    "structureScore" INTEGER NOT NULL,
    "clarityScore" INTEGER NOT NULL,
    "outcomesScore" INTEGER NOT NULL,
    "engagementScore" INTEGER NOT NULL,
    "recommendations" JSONB NOT NULL,
    "strengths" JSONB NOT NULL,
    "promptTemplateVersionId" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingQualityScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatV2Conversation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalSource" TEXT,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "scope" "ChatV2Scope" NOT NULL,
    "scopeRefId" TEXT,
    "channelKindOrigin" TEXT,
    "status" "ChatV2ConversationStatus" NOT NULL DEFAULT 'active',
    "pinnedAt" TIMESTAMP(3),
    "summary" TEXT,
    "summaryUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatV2Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatV2Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "ChatV2MessageRole" NOT NULL,
    "mode" "ChatV2Mode",
    "text" TEXT NOT NULL,
    "citations" JSONB,
    "retrievalMeta" JSONB,
    "llmMeta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatV2Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_profiles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "status" "SkillProfileStatus" NOT NULL DEFAULT 'active',
    "lastBuildAt" TIMESTAMP(3),
    "buildVersion" INTEGER NOT NULL DEFAULT 0,
    "dataClassAudit" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "externalSource" TEXT,

    CONSTRAINT "skill_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_traits" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "category" VARCHAR(200) NOT NULL,
    "categoryId" TEXT,
    "statement" TEXT NOT NULL,
    "confidence" "SkillConfidence" NOT NULL,
    "observationCount" INTEGER NOT NULL,
    "sourceBlockIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "firstObservedAt" TIMESTAMP(3) NOT NULL,
    "lastConfirmedAt" TIMESTAMP(3) NOT NULL,
    "status" "SkillTraitStatus" NOT NULL,
    "supersededById" TEXT,
    "misleadingReason" TEXT,
    "misleadingFlaggedByUserId" TEXT,
    "misleadingFlaggedAt" TIMESTAMP(3),
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "conceptId" TEXT,

    CONSTRAINT "skill_traits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_trait_concepts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "canonicalName" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "variants" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "embedding" vector(1536),
    "status" "SkillTraitConceptStatus" NOT NULL DEFAULT 'active',
    "mergedIntoId" TEXT,
    "traitCount" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skill_trait_concepts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_skills" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scope" "SkillScope" NOT NULL,
    "scopeRefId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "triggerEmbedding" vector(1536),
    "steps" JSONB NOT NULL,
    "examples" JSONB NOT NULL,
    "redFlags" JSONB NOT NULL,
    "status" "PracticeSkillStatus" NOT NULL DEFAULT 'shadow',
    "trafficShare" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "shadowMetrics" JSONB,
    "successRate" DOUBLE PRECISION,
    "lastUsed" TIMESTAMP(3),
    "derivedFromConceptIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "derivedFromTraitIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "derivedFromEpisodeCount" INTEGER NOT NULL DEFAULT 0,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "promotedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "archivedReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "practice_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_usages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "practiceSkillId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "wasUsed" BOOLEAN NOT NULL DEFAULT true,
    "outcome" VARCHAR(40),
    "editDistance" DOUBLE PRECISION,
    "downstreamSignals" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_trait_categories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(220) NOT NULL,
    "description" TEXT,
    "parentCategoryId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skill_trait_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "executable_personas" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "profileId" TEXT,
    "scope" "PersonaScope" NOT NULL,
    "scopeRefId" TEXT,
    "version" INTEGER NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "personaPrompt" TEXT NOT NULL,
    "includedTraitIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "PersonaStatus" NOT NULL,
    "builtFromTraitsCount" INTEGER NOT NULL,
    "triggerReason" VARCHAR(40),
    "triggerEventAt" TIMESTAMP(3),
    "roleVersion" INTEGER DEFAULT 1,
    "currentBearerPersonId" TEXT,
    "publicName" TEXT,
    "succeedsPersonaId" TEXT,
    "dataClassAudit" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "externalSource" TEXT,

    CONSTRAINT "executable_personas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hypothesisText" TEXT NOT NULL,
    "ownerEntityId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'hypothesis',
    "currentResult" TEXT,
    "lessonsJson" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "sourceBlockIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "personSubjectIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "currentVersionId" TEXT,
    "confidence" DECIMAL(4,3) NOT NULL DEFAULT 0.500,
    "entityId" TEXT,
    "lastConfirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "experiments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiment_versions" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "snapshotJson" JSONB NOT NULL,
    "changeReason" VARCHAR(120),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiment_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concierge_conversations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pageContextJson" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3),
    "summary" TEXT,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "concierge_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concierge_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" VARCHAR(16) NOT NULL,
    "content" TEXT NOT NULL,
    "toolCallsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "concierge_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concierge_undo_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "toolName" VARCHAR(120) NOT NULL,
    "paramsJson" JSONB NOT NULL,
    "resultJson" JSONB NOT NULL,
    "undoInstructionJson" JSONB,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rolledBackAt" TIMESTAMP(3),

    CONSTRAINT "concierge_undo_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_concierge_quotas" (
    "tenantId" TEXT NOT NULL,
    "dailyMessagesLimit" INTEGER NOT NULL DEFAULT 100,
    "monthlyMessagesLimit" INTEGER NOT NULL DEFAULT 3000,
    "currentDailyCount" INTEGER NOT NULL DEFAULT 0,
    "currentMonthlyCount" INTEGER NOT NULL DEFAULT 0,
    "resetDailyAt" TIMESTAMP(3),
    "resetMonthlyAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_concierge_quotas_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "orchestrator_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'planning',
    "planJson" JSONB,
    "synthesisJson" JSONB,
    "verificationJson" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "orchestrator_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orchestrator_subagent_jobs" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "agentType" VARCHAR(64) NOT NULL,
    "contextJson" JSONB NOT NULL,
    "resultJson" JSONB,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "orchestrator_subagent_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalSource" TEXT,
    "slug" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerId" TEXT NOT NULL,
    "defaultAssigneeId" TEXT,
    "defaultStateId" TEXT,
    "network" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow',
    "cycleViewEnabled" BOOLEAN NOT NULL DEFAULT true,
    "intakeViewEnabled" BOOLEAN NOT NULL DEFAULT true,
    "gantViewEnabled" BOOLEAN NOT NULL DEFAULT false,
    "timeTrackingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "emailInboxAlias" TEXT,
    "emailInboxEnabled" BOOLEAN NOT NULL DEFAULT false,
    "teamTemplateId" TEXT,
    "entityId" TEXT,
    "customerCardId" TEXT,
    "vendorId" TEXT,
    "subjectPersonId" TEXT,
    "departmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalSource" TEXT,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "contentHtml" TEXT,
    "contentStripped" TEXT,
    "parentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "entityId" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ProjectDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Board" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#5EEAD4',
    "icon" TEXT,
    "description" TEXT,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Board_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" INTEGER NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueState" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalSource" TEXT,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#94A3B8',
    "category" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "IssueState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cycle" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalSource" TEXT,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "ownedById" TEXT,
    "description" TEXT,
    "progressSnapshot" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "primaryGoalId" TEXT,

    CONSTRAINT "Cycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SprintHint" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalSource" TEXT,
    "cycleId" TEXT NOT NULL,
    "kind" "SprintHintKind" NOT NULL,
    "severity" "SprintHintSeverity" NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "body" TEXT NOT NULL,
    "affectedIssueIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceBlockIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "SprintHintStatus" NOT NULL DEFAULT 'active',
    "dismissedByUserId" TEXT,
    "dismissedAt" TIMESTAMP(3),
    "confidence" DECIMAL(4,3) NOT NULL,
    "contentHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SprintHint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Issue" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "sequenceId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "descriptionHtml" TEXT,
    "descriptionStripped" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'none',
    "stateId" TEXT,
    "parentId" TEXT,
    "estimatePoints" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "checklistTotalCount" INTEGER NOT NULL DEFAULT 0,
    "checklistDoneCount" INTEGER NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastOverdueDetectedAt" TIMESTAMP(3),
    "cycleId" TEXT,
    "boardId" TEXT,
    "goalId" TEXT,
    "meetingId" TEXT,
    "linkedMeetingIds" TEXT[],
    "sourceBlockIds" TEXT[],
    "confidence" DECIMAL(4,3),
    "createdManually" BOOLEAN NOT NULL DEFAULT true,
    "embedding" vector(1536),
    "embeddingHash" TEXT,
    "externalSource" TEXT,
    "externalId" TEXT,
    "entityId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueAssignee" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedById" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueAssignee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Label" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,

    CONSTRAINT "Label_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueLabel" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,

    CONSTRAINT "IssueLabel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueSubscriber" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subscribedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueSubscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueMention" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "commentId" TEXT,
    "mentionedUserId" TEXT NOT NULL,
    "mentionedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueMention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueComment" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "parentCommentId" TEXT,
    "content" TEXT NOT NULL,
    "contentHtml" TEXT,
    "contentStripped" TEXT,
    "access" TEXT NOT NULL DEFAULT 'internal',
    "voiceUrl" TEXT,
    "voiceDuration" INTEGER,
    "voiceTranscript" TEXT,
    "thanksUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "IssueComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueAttachment" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "commentId" TEXT,
    "uploaderId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueLink" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailInboundLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT,
    "messageId" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "MailInboundStatus" NOT NULL,
    "reason" TEXT,
    "issueId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailInboundLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueRelation" (
    "id" TEXT NOT NULL,
    "sourceIssueId" TEXT NOT NULL,
    "targetIssueId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueActivity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorType" TEXT NOT NULL,
    "agentName" TEXT,
    "verb" TEXT NOT NULL,
    "field" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "metadata" JSONB,
    "epoch" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueVersion" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueChecklist" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Чек-лист',
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "IssueChecklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueChecklistItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "checklistId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "isDone" BOOLEAN NOT NULL DEFAULT false,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakeIssue" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "source" TEXT NOT NULL,
    "sourceEmail" TEXT,
    "externalSource" TEXT,
    "externalId" TEXT,
    "rawContent" TEXT NOT NULL,
    "extractedTitle" TEXT,
    "extractedDescription" TEXT,
    "suggestedProjectId" TEXT,
    "suggestedAssigneeId" TEXT,
    "suggestedGoalId" TEXT,
    "suggestedPriority" TEXT,
    "suggestedDueDate" TIMESTAMP(3),
    "suggestedLabels" TEXT[],
    "confidence" DECIMAL(4,3),
    "triagedByUserId" TEXT,
    "triagedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "snoozedUntil" TIMESTAMP(3),
    "createdIssueId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntakeIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueWebhook" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secretKey" TEXT NOT NULL,
    "events" TEXT[],
    "allowedDataClasses" "DataClass"[] DEFAULT ARRAY['public', 'internal']::"DataClass"[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueWebhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueWebhookLog" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "requestMethod" TEXT NOT NULL,
    "requestUrl" TEXT NOT NULL,
    "requestHeaders" JSONB NOT NULL,
    "requestBody" JSONB NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" TEXT,
    "responseTime" INTEGER,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueWebhookLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "totalProjects" INTEGER NOT NULL DEFAULT 0,
    "totalIssues" INTEGER NOT NULL DEFAULT 0,
    "totalComments" INTEGER NOT NULL DEFAULT 0,
    "totalAttachments" INTEGER NOT NULL DEFAULT 0,
    "processedItems" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "status" TEXT NOT NULL DEFAULT 'running',
    "paramsJson" JSONB,
    "unmatchedJson" JSONB,
    "initiatedByUserId" TEXT NOT NULL,

    CONSTRAINT "ImportLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HolidayCalendar" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "isWorking" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HolidayCalendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityFeedItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "feedType" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceAgentName" TEXT,
    "sourceUserId" TEXT,
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "iconType" TEXT,
    "severity" TEXT DEFAULT 'normal',
    "status" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "visibilityScope" JSONB,
    "targetUserId" TEXT,
    "targetChannel" TEXT,
    "teamId" TEXT,
    "projectId" TEXT,
    "goalId" TEXT,
    "reactions" JSONB,
    "expiresAt" TIMESTAMP(3),
    "emittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "seenAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "actionedAt" TIMESTAMP(3),

    CONSTRAINT "ActivityFeedItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityFeedSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feedType" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "digestMode" TEXT NOT NULL DEFAULT 'realtime',
    "channels" TEXT[] DEFAULT ARRAY['in_app']::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityFeedSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpfulnessTrait" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "helperUserId" TEXT NOT NULL,
    "recipientUserId" TEXT,
    "traitType" TEXT NOT NULL,
    "intensity" DECIMAL(4,3) NOT NULL,
    "topicHint" TEXT,
    "sourceBlockIds" TEXT[],
    "evidenceQuote" TEXT,
    "contextEntityType" TEXT,
    "contextEntityId" TEXT,
    "embedding" vector(1536),
    "confidence" DECIMAL(4,3) NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'internal',
    "lastObservedAt" TIMESTAMP(3) NOT NULL,
    "decayedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpfulnessTrait_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialContributionProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "helpProvidedCount" INTEGER NOT NULL DEFAULT 0,
    "proactiveHintCount" INTEGER NOT NULL DEFAULT 0,
    "mentoringCount" INTEGER NOT NULL DEFAULT 0,
    "emotionalSupportCount" INTEGER NOT NULL DEFAULT 0,
    "expertiseTopics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "socialRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastWeekHelpCount" INTEGER NOT NULL DEFAULT 0,
    "lastMonthHelpCount" INTEGER NOT NULL DEFAULT 0,
    "contributionScoreCached" DECIMAL(6,3),
    "buildVersion" INTEGER NOT NULL DEFAULT 1,
    "lastBuiltAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialContributionProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpfulnessSpotlight" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalSource" TEXT,
    "helperUserId" TEXT NOT NULL,
    "topicHint" TEXT,
    "message" TEXT NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "helpCount" INTEGER NOT NULL,
    "traitIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approvedByUserId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "feedItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpfulnessSpotlight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recognition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalSource" TEXT,
    "fromUserId" TEXT,
    "toUserId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "contextEntityType" TEXT,
    "contextEntityId" TEXT,
    "message" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recognition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Badge" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "iconUrl" TEXT,
    "condition" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Badge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBadge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "badgeId" TEXT NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBadge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContributionSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ideasInDevelopment" INTEGER NOT NULL DEFAULT 0,
    "ideasShipped" INTEGER NOT NULL DEFAULT 0,
    "thanksReceived" INTEGER NOT NULL DEFAULT 0,
    "thanksReceivedWeek" INTEGER NOT NULL DEFAULT 0,
    "currentCheckinStreak" INTEGER NOT NULL DEFAULT 0,
    "longestCheckinStreak" INTEGER NOT NULL DEFAULT 0,
    "helpfulComments" INTEGER NOT NULL DEFAULT 0,
    "probeQuestionsAnswered" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContributionSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "category" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'low',
    "schemaId" TEXT,
    "description" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "comment" TEXT,

    CONSTRAINT "AdminSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AdminSettingHistory" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "prevValue" JSONB NOT NULL,
    "newValue" JSONB NOT NULL,
    "changedBy" TEXT NOT NULL,
    "reason" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminSettingHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "features" JSONB NOT NULL,
    "quotas" JSONB NOT NULL,
    "monthlyPriceRub" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "defaultValue" BOOLEAN NOT NULL,
    "orgOverrides" JSONB NOT NULL DEFAULT '{}',
    "rolloutPercent" INTEGER,
    "category" TEXT NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "htmlBody" TEXT,
    "variables" JSONB NOT NULL,
    "category" TEXT NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "MeetingTypeConfig" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "reportPromptKey" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingTypeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemMessage" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "targetOrgs" TEXT[],
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionPolicy" (
    "type" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "description" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("type")
);

-- CreateTable
CREATE TABLE "CronSchedule" (
    "name" TEXT NOT NULL,
    "expression" TEXT NOT NULL,
    "defaultExpression" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "lastRunDurationMs" INTEGER,
    "lastRunError" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CronSchedule_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "CronRunHistory" (
    "id" TEXT NOT NULL,
    "cronName" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMs" INTEGER,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "triggeredBy" TEXT,

    CONSTRAINT "CronRunHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_preference_samples" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "inputContext" JSONB NOT NULL,
    "modelOutput" JSONB NOT NULL,
    "label" VARCHAR(40) NOT NULL,
    "reason" TEXT,
    "recordedBy" VARCHAR(80) NOT NULL,
    "decisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_preference_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "failedRuns" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FeedbackMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackTopic" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "FeedbackTopicStatus" NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "mergedIntoId" TEXT,

    CONSTRAINT "FeedbackTopic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackItem" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "topicId" TEXT,
    "text" TEXT NOT NULL,
    "discarded" BOOLEAN NOT NULL DEFAULT false,
    "discardReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedbackItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'DEMO',
    "paymentMode" "PaymentMode",
    "billingPeriod" "BillingPeriod",
    "startedAt" TIMESTAMP(3),
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "pastDueUntil" TIMESTAMP(3),
    "seatsBase" INTEGER NOT NULL DEFAULT 30,
    "seatsExtra" INTEGER NOT NULL DEFAULT 0,
    "monthlyPriceKopecks" INTEGER NOT NULL DEFAULT 6000000,
    "totalPaidKopecks" INTEGER NOT NULL DEFAULT 0,
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "renewalMethod" "BillingPaymentMethod",
    "providerName" "BillingProviderName",
    "providerSubscriptionId" TEXT,
    "providerCustomerCode" TEXT,
    "providerConsumerId" TEXT,
    "lastRenewalAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionEvent" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "byUserId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "billingNumber" SERIAL NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "items" JSONB NOT NULL,
    "totalKopecks" INTEGER NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'draft',
    "paymentMethod" "BillingPaymentMethod",
    "pdfUrl" TEXT,
    "pdfSource" TEXT,
    "pdfFetchedAt" TIMESTAMP(3),
    "providerName" "BillingProviderName",
    "providerInvoiceId" TEXT,
    "paymentUrl" TEXT,
    "externalStatus" TEXT,
    "issuedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "externalRef" TEXT,
    "markedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingEventLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "subscriptionId" TEXT,
    "invoiceId" TEXT,
    "eventType" TEXT NOT NULL,
    "providerName" "BillingProviderName",
    "externalEventId" TEXT,
    "jti" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingProviderConfig" (
    "key" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingProviderConfig_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "MeetingsBalance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "totalGranted" INTEGER NOT NULL DEFAULT 0,
    "totalConsumed" INTEGER NOT NULL DEFAULT 0,
    "lastGrantedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingsBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "inn" VARCHAR(20),
    "innVerifiedAt" TIMESTAMP(3),
    "legalForm" "ReferralLegalForm",
    "payoutDetails" JSONB,
    "contractAcceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralAttribution" (
    "id" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "fingerprint" VARCHAR(64),
    "ip" VARCHAR(45),
    "userAgent" TEXT,
    "referer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "dateBucket" VARCHAR(10),

    CONSTRAINT "ReferralAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientReferralLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "attachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstPaidAt" TIMESTAMP(3),
    "sourceAttributionId" TEXT,
    "subscriptionId" TEXT,

    CONSTRAINT "ClientReferralLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralPayout" (
    "id" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "clientReferralLinkId" TEXT NOT NULL,
    "triggerInvoiceId" TEXT,
    "periodMonth" VARCHAR(7) NOT NULL,
    "amountKopecks" INTEGER NOT NULL DEFAULT 2000000,
    "status" "ReferralPayoutStatus" NOT NULL DEFAULT 'pending',
    "payoutDocumentUrl" TEXT,
    "paidAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptFeedback" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "promptKey" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "invocationId" TEXT NOT NULL,
    "inputDigest" TEXT NOT NULL,
    "inputEmbedding" vector(1536),
    "originalOutput" TEXT NOT NULL,
    "editedOutput" TEXT,
    "editDistance" DOUBLE PRECISION,
    "editedAt" TIMESTAMP(3),
    "editedByUserId" TEXT,
    "downstreamSignals" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "promptKey" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "ruleType" "RuleType" NOT NULL,
    "source" "RuleSource" NOT NULL,
    "examples" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" "RuleStatus" NOT NULL,
    "shadowMetrics" JSONB,
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "promotedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "archivedReason" TEXT,

    CONSTRAINT "PromptRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concierge_step_scores" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "goalSummary" TEXT NOT NULL,
    "selectedTool" JSONB NOT NULL,
    "alternatives" JSONB NOT NULL,
    "selectedScore" DOUBLE PRECISION NOT NULL,
    "selectedRank" INTEGER NOT NULL,
    "llmChoseRank" INTEGER NOT NULL,
    "prmAgreed" BOOLEAN NOT NULL,
    "promotedToActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "concierge_step_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptCandidate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "promptKey" TEXT NOT NULL,
    "parentVersion" TEXT,
    "promptText" TEXT NOT NULL,
    "systemPart" TEXT,
    "userPart" TEXT,
    "paretoMetric" JSONB NOT NULL,
    "reflectionTraces" JSONB NOT NULL,
    "status" "CandidateStatus" NOT NULL,
    "evaluations" INTEGER NOT NULL DEFAULT 0,
    "compositeScore" DOUBLE PRECISION,
    "abTrafficShare" DOUBLE PRECISION,
    "abStartedAt" TIMESTAMP(3),
    "abEndedAt" TIMESTAMP(3),
    "promotedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Table" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "icon" VARCHAR(50),
    "coverImageS3" VARCHAR(500),
    "parentDocumentId" TEXT,
    "entitySync" JSONB,
    "defaultViewId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "systemKey" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Table_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TableProperty" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "type" "TablePropType" NOT NULL,
    "config" JSONB NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "order" DECIMAL(20,10) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TableProperty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TableRow" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cells" JSONB NOT NULL,
    "entityId" TEXT,
    "order" DECIMAL(20,10) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "pageContent" JSONB,

    CONSTRAINT "TableRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TableView" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "type" "TableViewType" NOT NULL,
    "config" JSONB NOT NULL,
    "visibility" "TableViewVisibility" NOT NULL DEFAULT 'personal',
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TableView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TableAutomation" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "trigger" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TableAutomation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TableCellProvenance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tableRowId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "sourceLink" TEXT,
    "previousValue" JSONB,
    "appliedValue" JSONB,
    "confidence" DECIMAL(3,2),
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedBy" TEXT NOT NULL,
    "rolledBackAt" TIMESTAMP(3),

    CONSTRAINT "TableCellProvenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TableCellPendingPatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "tableRowId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "proposedValue" JSONB NOT NULL,
    "currentValue" JSONB,
    "confidence" DECIMAL(3,2) NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "sourceLink" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,

    CONSTRAINT "TableCellPendingPatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemLog" (
    "id" TEXT NOT NULL,
    "level" "SystemLogLevel" NOT NULL,
    "category" "SystemLogCategory" NOT NULL DEFAULT 'SYSTEM',
    "contour" "SystemLogContour" NOT NULL DEFAULT 'SYSTEM',
    "pipeline" "SystemLogPipeline",
    "module" TEXT,
    "action" TEXT,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "userId" TEXT,
    "userRole" TEXT,
    "orgId" TEXT,
    "requestId" TEXT,
    "traceId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "method" TEXT,
    "path" TEXT,
    "statusCode" INTEGER,
    "durationMs" INTEGER,
    "errorName" TEXT,
    "errorMessage" TEXT,
    "errorStack" TEXT,
    "environment" TEXT,
    "instanceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_externalId_key" ON "User"("externalId");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_signupSource_key" ON "User"("email", "signupSource");

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_jti_key" ON "UserSession"("jti");

-- CreateIndex
CREATE INDEX "UserSession_userId_revokedAt_idx" ON "UserSession"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "UserSession_expiresAt_idx" ON "UserSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserVerificationToken_tokenHash_key" ON "UserVerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "UserVerificationToken_userId_purpose_idx" ON "UserVerificationToken"("userId", "purpose");

-- CreateIndex
CREATE INDEX "UserVerificationToken_expiresAt_idx" ON "UserVerificationToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_roomName_key" ON "Meeting"("roomName");

-- CreateIndex
CREATE INDEX "Meeting_ownerId_createdAt_idx" ON "Meeting"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "Meeting_status_endedAt_idx" ON "Meeting"("status", "endedAt");

-- CreateIndex
CREATE INDEX "Meeting_deletedAt_idx" ON "Meeting"("deletedAt");

-- CreateIndex
CREATE INDEX "Meeting_cardId_createdAt_idx" ON "Meeting"("cardId", "createdAt");

-- CreateIndex
CREATE INDEX "Meeting_tenantId_idx" ON "Meeting"("tenantId");

-- CreateIndex
CREATE INDEX "Meeting_linkedIssueId_idx" ON "Meeting"("linkedIssueId");

-- CreateIndex
CREATE INDEX "Meeting_linkedCycleId_idx" ON "Meeting"("linkedCycleId");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_inviteToken_key" ON "Participant"("inviteToken");

-- CreateIndex
CREATE INDEX "Participant_meetingId_idx" ON "Participant"("meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_meetingId_livekitIdentity_key" ON "Participant"("meetingId", "livekitIdentity");

-- CreateIndex
CREATE UNIQUE INDEX "Recording_meetingId_key" ON "Recording"("meetingId");

-- CreateIndex
CREATE INDEX "Recording_expiresAt_status_idx" ON "Recording"("expiresAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AudioTrack_participantId_key" ON "AudioTrack"("participantId");

-- CreateIndex
CREATE INDEX "AudioTrack_recordingId_idx" ON "AudioTrack"("recordingId");

-- CreateIndex
CREATE UNIQUE INDEX "Transcript_meetingId_key" ON "Transcript"("meetingId");

-- CreateIndex
CREATE INDEX "TranscriptTrack_transcriptId_idx" ON "TranscriptTrack"("transcriptId");

-- CreateIndex
CREATE UNIQUE INDEX "TranscriptTrack_transcriptId_livekitIdentity_key" ON "TranscriptTrack"("transcriptId", "livekitIdentity");

-- CreateIndex
CREATE UNIQUE INDEX "AiResult_meetingId_key" ON "AiResult"("meetingId");

-- CreateIndex
CREATE INDEX "AiResult_promptTemplateVersionId_idx" ON "AiResult"("promptTemplateVersionId");

-- CreateIndex
CREATE INDEX "AiUsageLog_meetingId_idx" ON "AiUsageLog"("meetingId");

-- CreateIndex
CREATE INDEX "AiUsageLog_createdAt_idx" ON "AiUsageLog"("createdAt");

-- CreateIndex
CREATE INDEX "AiUsageLog_userId_taskType_createdAt_idx" ON "AiUsageLog"("userId", "taskType", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsageLog_tenantId_createdAt_idx" ON "AiUsageLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsageLog_tenantId_taskType_createdAt_idx" ON "AiUsageLog"("tenantId", "taskType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationKey_keyHash_key" ON "IntegrationKey"("keyHash");

-- CreateIndex
CREATE INDEX "IntegrationKey_revokedAt_idx" ON "IntegrationKey"("revokedAt");

-- CreateIndex
CREATE INDEX "CrossmarkIdempotency_createdAt_idx" ON "CrossmarkIdempotency"("createdAt");

-- CreateIndex
CREATE INDEX "MeetingEvent_meetingId_receivedAt_idx" ON "MeetingEvent"("meetingId", "receivedAt");

-- CreateIndex
CREATE INDEX "RecordingAction_recordingId_idx" ON "RecordingAction"("recordingId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_actorId_createdAt_idx" ON "AdminAuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "Task_userId_status_idx" ON "Task"("userId", "status");

-- CreateIndex
CREATE INDEX "Task_meetingId_idx" ON "Task"("meetingId");

-- CreateIndex
CREATE INDEX "Task_dueDate_idx" ON "Task"("dueDate");

-- CreateIndex
CREATE INDEX "Task_tenantId_idx" ON "Task"("tenantId");

-- CreateIndex
CREATE INDEX "Task_assigneeUserId_idx" ON "Task"("assigneeUserId");

-- CreateIndex
CREATE INDEX "MeetingChapter_meetingId_order_idx" ON "MeetingChapter"("meetingId", "order");

-- CreateIndex
CREATE INDEX "MeetingChapter_tenantId_idx" ON "MeetingChapter"("tenantId");

-- CreateIndex
CREATE INDEX "MeetingHighlight_meetingId_idx" ON "MeetingHighlight"("meetingId");

-- CreateIndex
CREATE INDEX "MeetingHighlight_tenantId_idx" ON "MeetingHighlight"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingShare_token_key" ON "MeetingShare"("token");

-- CreateIndex
CREATE INDEX "MeetingShare_meetingId_idx" ON "MeetingShare"("meetingId");

-- CreateIndex
CREATE INDEX "MeetingShare_expiresAt_idx" ON "MeetingShare"("expiresAt");

-- CreateIndex
CREATE INDEX "MeetingShareView_shareId_viewedAt_idx" ON "MeetingShareView"("shareId", "viewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HighlightShare_token_key" ON "HighlightShare"("token");

-- CreateIndex
CREATE INDEX "HighlightShare_highlightId_idx" ON "HighlightShare"("highlightId");

-- CreateIndex
CREATE INDEX "Tag_userId_idx" ON "Tag"("userId");

-- CreateIndex
CREATE INDEX "Tag_tenantId_idx" ON "Tag"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_userId_name_key" ON "Tag"("userId", "name");

-- CreateIndex
CREATE INDEX "MeetingTag_tagId_idx" ON "MeetingTag"("tagId");

-- CreateIndex
CREATE INDEX "MeetingChatMessage_userId_createdAt_idx" ON "MeetingChatMessage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "MeetingChatMessage_meetingId_createdAt_idx" ON "MeetingChatMessage"("meetingId", "createdAt");

-- CreateIndex
CREATE INDEX "MeetingChatMessage_cardId_createdAt_idx" ON "MeetingChatMessage"("cardId", "createdAt");

-- CreateIndex
CREATE INDEX "MeetingChatMessage_tenantId_createdAt_idx" ON "MeetingChatMessage"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingRoomMessage_clientMessageId_key" ON "MeetingRoomMessage"("clientMessageId");

-- CreateIndex
CREATE INDEX "MeetingRoomMessage_meetingId_sentAt_idx" ON "MeetingRoomMessage"("meetingId", "sentAt");

-- CreateIndex
CREATE INDEX "MeetingTranscriptChunk_meetingId_idx" ON "MeetingTranscriptChunk"("meetingId");

-- CreateIndex
CREATE INDEX "MeetingTranscriptChunk_userId_idx" ON "MeetingTranscriptChunk"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingTranscriptChunk_meetingId_startMs_endMs_key" ON "MeetingTranscriptChunk"("meetingId", "startMs", "endMs");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_hashedKey_key" ON "ApiKey"("hashedKey");

-- CreateIndex
CREATE INDEX "ApiKey_userId_idx" ON "ApiKey"("userId");

-- CreateIndex
CREATE INDEX "ApiKey_tenantId_idx" ON "ApiKey"("tenantId");

-- CreateIndex
CREATE INDEX "ApiKey_prefix_idx" ON "ApiKey"("prefix");

-- CreateIndex
CREATE INDEX "WebhookSubscription_userId_idx" ON "WebhookSubscription"("userId");

-- CreateIndex
CREATE INDEX "WebhookSubscription_tenantId_idx" ON "WebhookSubscription"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_eventId_key" ON "WebhookDelivery"("eventId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_subscriptionId_createdAt_idx" ON "WebhookDelivery"("subscriptionId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_nextAttemptAt_idx" ON "WebhookDelivery"("nextAttemptAt");

-- CreateIndex
CREATE INDEX "IntegrationDestination_userId_idx" ON "IntegrationDestination"("userId");

-- CreateIndex
CREATE INDEX "IntegrationDestination_tenantId_idx" ON "IntegrationDestination"("tenantId");

-- CreateIndex
CREATE INDEX "Export_userId_createdAt_idx" ON "Export"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Export_expiresAt_idx" ON "Export"("expiresAt");

-- CreateIndex
CREATE INDEX "Export_tenantId_idx" ON "Export"("tenantId");

-- CreateIndex
CREATE INDEX "UserTemplate_userId_idx" ON "UserTemplate"("userId");

-- CreateIndex
CREATE INDEX "LlmTaskRoute_tenantId_idx" ON "LlmTaskRoute"("tenantId");

-- CreateIndex
CREATE INDEX "LlmTaskRoute_taskType_tier_priority_idx" ON "LlmTaskRoute"("taskType", "tier", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "LlmTaskRoute_taskType_tenantId_tier_providerName_key" ON "LlmTaskRoute"("taskType", "tenantId", "tier", "providerName");

-- CreateIndex
CREATE INDEX "LlmTaskRouteChange_taskType_createdAt_idx" ON "LlmTaskRouteChange"("taskType", "createdAt");

-- CreateIndex
CREATE INDEX "LlmTaskRouteChange_changedById_createdAt_idx" ON "LlmTaskRouteChange"("changedById", "createdAt");

-- CreateIndex
CREATE INDEX "LlmTaskRouteChange_tenantId_taskType_createdAt_idx" ON "LlmTaskRouteChange"("tenantId", "taskType", "createdAt");

-- CreateIndex
CREATE INDEX "LlmModelExperiment_tenantId_taskType_status_idx" ON "LlmModelExperiment"("tenantId", "taskType", "status");

-- CreateIndex
CREATE INDEX "LlmModelExperiment_status_startedAt_idx" ON "LlmModelExperiment"("status", "startedAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "ConsentLog_tenantId_personId_dataType_createdAt_idx" ON "ConsentLog"("tenantId", "personId", "dataType", "createdAt");

-- CreateIndex
CREATE INDEX "ConsentLog_tenantId_createdAt_idx" ON "ConsentLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeAccessLog_tenantId_viewedPersonId_accessedAt_idx" ON "KnowledgeAccessLog"("tenantId", "viewedPersonId", "accessedAt");

-- CreateIndex
CREATE INDEX "KnowledgeAccessLog_tenantId_viewerUserId_accessedAt_idx" ON "KnowledgeAccessLog"("tenantId", "viewerUserId", "accessedAt");

-- CreateIndex
CREATE INDEX "ApiAccessLog_apiKeyId_createdAt_idx" ON "ApiAccessLog"("apiKeyId", "createdAt");

-- CreateIndex
CREATE INDEX "ApiAccessLog_userId_createdAt_idx" ON "ApiAccessLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ApiAccessLog_status_createdAt_idx" ON "ApiAccessLog"("status", "createdAt");

-- CreateIndex
CREATE INDEX "UserQuotaCounter_userId_quotaName_idx" ON "UserQuotaCounter"("userId", "quotaName");

-- CreateIndex
CREATE UNIQUE INDEX "UserQuotaCounter_userId_quotaName_windowStart_key" ON "UserQuotaCounter"("userId", "quotaName", "windowStart");

-- CreateIndex
CREATE INDEX "Card_ownerId_lastMeetingAt_idx" ON "Card"("ownerId", "lastMeetingAt");

-- CreateIndex
CREATE INDEX "Card_ownerId_archivedAt_idx" ON "Card"("ownerId", "archivedAt");

-- CreateIndex
CREATE INDEX "Card_deletedAt_idx" ON "Card"("deletedAt");

-- CreateIndex
CREATE INDEX "Card_tenantId_idx" ON "Card"("tenantId");

-- CreateIndex
CREATE INDEX "Card_entityId_idx" ON "Card"("entityId");

-- CreateIndex
CREATE INDEX "Card_bornFromThemeId_idx" ON "Card"("bornFromThemeId");

-- CreateIndex
CREATE INDEX "Card_currentVersionId_idx" ON "Card"("currentVersionId");

-- CreateIndex
CREATE INDEX "Card_tenantId_lastConfirmedAt_idx" ON "Card"("tenantId", "lastConfirmedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Card_ownerId_name_key" ON "Card"("ownerId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Org_slug_key" ON "Org"("slug");

-- CreateIndex
CREATE INDEX "Org_ownerId_idx" ON "Org"("ownerId");

-- CreateIndex
CREATE INDEX "Org_deletedAt_idx" ON "Org"("deletedAt");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE INDEX "Membership_orgId_role_idx" ON "Membership"("orgId", "role");

-- CreateIndex
CREATE INDEX "Membership_personId_idx" ON "Membership"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_orgId_userId_key" ON "Membership"("orgId", "userId");

-- CreateIndex
CREATE INDEX "CloneAccessGrant_tenantId_grantedToUserId_idx" ON "CloneAccessGrant"("tenantId", "grantedToUserId");

-- CreateIndex
CREATE INDEX "CloneAccessGrant_tenantId_cloneType_cloneRefId_idx" ON "CloneAccessGrant"("tenantId", "cloneType", "cloneRefId");

-- CreateIndex
CREATE INDEX "CloneAccessGrant_revokedAt_idx" ON "CloneAccessGrant"("revokedAt");

-- CreateIndex
CREATE INDEX "CloneAccessGrant_expiresAt_idx" ON "CloneAccessGrant"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CloneAccessGrant_tenantId_grantedToUserId_cloneType_cloneRe_key" ON "CloneAccessGrant"("tenantId", "grantedToUserId", "cloneType", "cloneRefId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgInvitation_token_key" ON "OrgInvitation"("token");

-- CreateIndex
CREATE UNIQUE INDEX "OrgInvitation_linkCode_key" ON "OrgInvitation"("linkCode");

-- CreateIndex
CREATE UNIQUE INDEX "OrgInvitation_magicTokenHash_key" ON "OrgInvitation"("magicTokenHash");

-- CreateIndex
CREATE INDEX "OrgInvitation_orgId_status_idx" ON "OrgInvitation"("orgId", "status");

-- CreateIndex
CREATE INDEX "OrgInvitation_email_status_idx" ON "OrgInvitation"("email", "status");

-- CreateIndex
CREATE INDEX "OrgInvitation_expiresAt_idx" ON "OrgInvitation"("expiresAt");

-- CreateIndex
CREATE INDEX "OrgInvitation_personId_idx" ON "OrgInvitation"("personId");

-- CreateIndex
CREATE INDEX "EmployeeCapabilityOverride_tenantId_grantedToUserId_idx" ON "EmployeeCapabilityOverride"("tenantId", "grantedToUserId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeCapabilityOverride_tenantId_grantedToUserId_capabil_key" ON "EmployeeCapabilityOverride"("tenantId", "grantedToUserId", "capability");

-- CreateIndex
CREATE INDEX "LlmModelPrice_provider_model_effectiveFrom_idx" ON "LlmModelPrice"("provider", "model", "effectiveFrom");

-- CreateIndex
CREATE INDEX "LlmModelPrice_modelId_effectiveFrom_idx" ON "LlmModelPrice"("modelId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "LlmModelPrice_effectiveFrom_effectiveTo_idx" ON "LlmModelPrice"("effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "llm_providers_name_key" ON "llm_providers"("name");

-- CreateIndex
CREATE INDEX "llm_providers_isActive_protocolKind_idx" ON "llm_providers"("isActive", "protocolKind");

-- CreateIndex
CREATE INDEX "llm_models_providerId_isActive_idx" ON "llm_models"("providerId", "isActive");

-- CreateIndex
CREATE INDEX "llm_models_category_idx" ON "llm_models"("category");

-- CreateIndex
CREATE UNIQUE INDEX "llm_models_providerId_modelKey_key" ON "llm_models"("providerId", "modelKey");

-- CreateIndex
CREATE INDEX "ai_cost_daily_tenantId_date_idx" ON "ai_cost_daily"("tenantId", "date");

-- CreateIndex
CREATE INDEX "ai_cost_daily_date_taskType_idx" ON "ai_cost_daily"("date", "taskType");

-- CreateIndex
CREATE UNIQUE INDEX "ai_cost_daily_tenantId_date_taskType_provider_model_key" ON "ai_cost_daily"("tenantId", "date", "taskType", "provider", "model");

-- CreateIndex
CREATE UNIQUE INDEX "org_budget_caps_tenantId_key" ON "org_budget_caps"("tenantId");

-- CreateIndex
CREATE INDEX "org_budget_caps_tenantId_idx" ON "org_budget_caps"("tenantId");

-- CreateIndex
CREATE INDEX "currency_rates_rateDate_idx" ON "currency_rates"("rateDate");

-- CreateIndex
CREATE UNIQUE INDEX "currency_rates_baseCurrency_quoteCurrency_rateDate_source_key" ON "currency_rates"("baseCurrency", "quoteCurrency", "rateDate", "source");

-- CreateIndex
CREATE INDEX "Source_tenantId_isActive_idx" ON "Source"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Source_tenantId_type_name_key" ON "Source"("tenantId", "type", "name");

-- CreateIndex
CREATE UNIQUE INDEX "RawEvent_idempotencyKey_key" ON "RawEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "RawEvent_tenantId_sourceId_occurredAt_idx" ON "RawEvent"("tenantId", "sourceId", "occurredAt");

-- CreateIndex
CREATE INDEX "RawEvent_tenantId_processingStatus_idx" ON "RawEvent"("tenantId", "processingStatus");

-- CreateIndex
CREATE INDEX "IdeaBlock_tenantId_status_idx" ON "IdeaBlock"("tenantId", "status");

-- CreateIndex
CREATE INDEX "IdeaBlock_tenantId_signalType_idx" ON "IdeaBlock"("tenantId", "signalType");

-- CreateIndex
CREATE INDEX "IdeaBlock_tenantId_mergedIntoId_idx" ON "IdeaBlock"("tenantId", "mergedIntoId");

-- CreateIndex
CREATE INDEX "IdeaBlock_tenantId_roleRelevant_roleId_idx" ON "IdeaBlock"("tenantId", "roleRelevant", "roleId");

-- CreateIndex
CREATE INDEX "IdeaBlock_tenantId_signalType_commitmentStatus_commitmentDu_idx" ON "IdeaBlock"("tenantId", "signalType", "commitmentStatus", "commitmentDueDate");

-- CreateIndex
CREATE INDEX "IdeaBlock_tenantId_signalType_commitmentStatus_idx" ON "IdeaBlock"("tenantId", "signalType", "commitmentStatus");

-- CreateIndex
CREATE INDEX "IdeaBlock_tenantId_validUntil_idx" ON "IdeaBlock"("tenantId", "validUntil");

-- CreateIndex
CREATE INDEX "IdeaBlock_tenantId_signalType_validUntil_idx" ON "IdeaBlock"("tenantId", "signalType", "validUntil");

-- CreateIndex
CREATE INDEX "IdeaBlockAxisLabel_tenantId_blockId_idx" ON "IdeaBlockAxisLabel"("tenantId", "blockId");

-- CreateIndex
CREATE INDEX "IdeaBlockAxisLabel_tenantId_axis_label_idx" ON "IdeaBlockAxisLabel"("tenantId", "axis", "label");

-- CreateIndex
CREATE INDEX "IdeaBlockAxisLabel_axis_label_idx" ON "IdeaBlockAxisLabel"("axis", "label");

-- CreateIndex
CREATE UNIQUE INDEX "IdeaBlockAxisLabel_tenantId_blockId_axis_label_key" ON "IdeaBlockAxisLabel"("tenantId", "blockId", "axis", "label");

-- CreateIndex
CREATE INDEX "IdeaBlockEvidence_blockId_idx" ON "IdeaBlockEvidence"("blockId");

-- CreateIndex
CREATE INDEX "IdeaBlockEvidence_rawEventId_idx" ON "IdeaBlockEvidence"("rawEventId");

-- CreateIndex
CREATE INDEX "Entity_tenantId_type_idx" ON "Entity"("tenantId", "type");

-- CreateIndex
CREATE INDEX "Entity_tenantId_mergedIntoId_idx" ON "Entity"("tenantId", "mergedIntoId");

-- CreateIndex
CREATE INDEX "Entity_tenantId_canonicalName_idx" ON "Entity"("tenantId", "canonicalName");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_entityId_key" ON "Vendor"("entityId");

-- CreateIndex
CREATE INDEX "Vendor_tenantId_status_idx" ON "Vendor"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Vendor_tenantId_segment_idx" ON "Vendor"("tenantId", "segment");

-- CreateIndex
CREATE INDEX "Vendor_tenantId_deletedAt_idx" ON "Vendor"("tenantId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Event_entityId_key" ON "Event"("entityId");

-- CreateIndex
CREATE INDEX "Event_tenantId_startAt_idx" ON "Event"("tenantId", "startAt");

-- CreateIndex
CREATE INDEX "Event_tenantId_kind_idx" ON "Event"("tenantId", "kind");

-- CreateIndex
CREATE INDEX "Event_tenantId_deletedAt_idx" ON "Event"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "Event_tenantId_ownerId_startAt_idx" ON "Event"("tenantId", "ownerId", "startAt");

-- CreateIndex
CREATE INDEX "Event_tenantId_projectId_startAt_idx" ON "Event"("tenantId", "projectId", "startAt");

-- CreateIndex
CREATE INDEX "Event_externalProvider_externalEventId_idx" ON "Event"("externalProvider", "externalEventId");

-- CreateIndex
CREATE INDEX "EventParticipant_eventId_idx" ON "EventParticipant"("eventId");

-- CreateIndex
CREATE INDEX "EventParticipant_userId_rsvp_idx" ON "EventParticipant"("userId", "rsvp");

-- CreateIndex
CREATE INDEX "EventParticipant_personId_idx" ON "EventParticipant"("personId");

-- CreateIndex
CREATE INDEX "EventReminder_eventId_idx" ON "EventReminder"("eventId");

-- CreateIndex
CREATE INDEX "EventReminder_sentAt_eventId_idx" ON "EventReminder"("sentAt", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Market_entityId_key" ON "Market"("entityId");

-- CreateIndex
CREATE INDEX "Market_tenantId_geography_idx" ON "Market"("tenantId", "geography");

-- CreateIndex
CREATE INDEX "Market_tenantId_industry_idx" ON "Market"("tenantId", "industry");

-- CreateIndex
CREATE INDEX "Market_tenantId_deletedAt_idx" ON "Market"("tenantId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrgUnit_entityId_key" ON "OrgUnit"("entityId");

-- CreateIndex
CREATE INDEX "OrgUnit_tenantId_unitKind_idx" ON "OrgUnit"("tenantId", "unitKind");

-- CreateIndex
CREATE INDEX "OrgUnit_tenantId_parentDepartmentId_idx" ON "OrgUnit"("tenantId", "parentDepartmentId");

-- CreateIndex
CREATE INDEX "OrgUnit_tenantId_deletedAt_idx" ON "OrgUnit"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "CurationItem_tenantId_status_idx" ON "CurationItem"("tenantId", "status");

-- CreateIndex
CREATE INDEX "CurationItem_tenantId_level_status_idx" ON "CurationItem"("tenantId", "level", "status");

-- CreateIndex
CREATE INDEX "CurationItem_assignedToUserId_status_idx" ON "CurationItem"("assignedToUserId", "status");

-- CreateIndex
CREATE INDEX "CurationItem_resourceType_resourceId_idx" ON "CurationItem"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "CurationItem_expiresAt_idx" ON "CurationItem"("expiresAt");

-- CreateIndex
CREATE INDEX "CurationDecision_curationItemId_idx" ON "CurationDecision"("curationItemId");

-- CreateIndex
CREATE INDEX "CurationDecision_reviewerUserId_idx" ON "CurationDecision"("reviewerUserId");

-- CreateIndex
CREATE INDEX "PendingActionSnooze_tenantId_userId_snoozedUntil_idx" ON "PendingActionSnooze"("tenantId", "userId", "snoozedUntil");

-- CreateIndex
CREATE UNIQUE INDEX "PendingActionSnooze_tenantId_userId_source_resourceId_key" ON "PendingActionSnooze"("tenantId", "userId", "source", "resourceId");

-- CreateIndex
CREATE INDEX "ConflictItem_tenantId_status_idx" ON "ConflictItem"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ConflictItem_tenantId_resourceType_status_idx" ON "ConflictItem"("tenantId", "resourceType", "status");

-- CreateIndex
CREATE INDEX "ConflictItem_resourceType_existingId_idx" ON "ConflictItem"("resourceType", "existingId");

-- CreateIndex
CREATE INDEX "ConflictItem_resourceType_newId_idx" ON "ConflictItem"("resourceType", "newId");

-- CreateIndex
CREATE INDEX "CardVersion_tenantId_resourceType_idx" ON "CardVersion"("tenantId", "resourceType");

-- CreateIndex
CREATE INDEX "CardVersion_resourceType_resourceId_idx" ON "CardVersion"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "CardVersion_curationItemId_idx" ON "CardVersion"("curationItemId");

-- CreateIndex
CREATE INDEX "CardVersion_tenantId_trustTier_idx" ON "CardVersion"("tenantId", "trustTier");

-- CreateIndex
CREATE UNIQUE INDEX "CardVersion_resourceType_resourceId_version_key" ON "CardVersion"("resourceType", "resourceId", "version");

-- CreateIndex
CREATE INDEX "CuratorAssignment_tenantId_resourceType_idx" ON "CuratorAssignment"("tenantId", "resourceType");

-- CreateIndex
CREATE INDEX "completeness_slots_tenantId_parentCardType_parentCardId_idx" ON "completeness_slots"("tenantId", "parentCardType", "parentCardId");

-- CreateIndex
CREATE INDEX "completeness_slots_tenantId_filledAt_idx" ON "completeness_slots"("tenantId", "filledAt");

-- CreateIndex
CREATE UNIQUE INDEX "completeness_slots_tenantId_parentCardType_parentCardId_slo_key" ON "completeness_slots"("tenantId", "parentCardType", "parentCardId", "slotName");

-- CreateIndex
CREATE INDEX "IdeaBlockEntity_entityId_idx" ON "IdeaBlockEntity"("entityId");

-- CreateIndex
CREATE INDEX "IdeaBlockLink_tenantId_status_idx" ON "IdeaBlockLink"("tenantId", "status");

-- CreateIndex
CREATE INDEX "IdeaBlockLink_fromBlockId_status_idx" ON "IdeaBlockLink"("fromBlockId", "status");

-- CreateIndex
CREATE INDEX "IdeaBlockLink_toBlockId_status_idx" ON "IdeaBlockLink"("toBlockId", "status");

-- CreateIndex
CREATE INDEX "IdeaBlockLink_tenantId_deletedAt_idx" ON "IdeaBlockLink"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "IdeaBlockLink_fromBlockId_validFrom_validUntil_idx" ON "IdeaBlockLink"("fromBlockId", "validFrom", "validUntil");

-- CreateIndex
CREATE INDEX "IdeaBlockLink_toBlockId_validFrom_validUntil_idx" ON "IdeaBlockLink"("toBlockId", "validFrom", "validUntil");

-- CreateIndex
CREATE UNIQUE INDEX "IdeaBlockLink_fromBlockId_toBlockId_relationType_key" ON "IdeaBlockLink"("fromBlockId", "toBlockId", "relationType");

-- CreateIndex
CREATE INDEX "EntityLink_tenantId_status_idx" ON "EntityLink"("tenantId", "status");

-- CreateIndex
CREATE INDEX "EntityLink_tenantId_fromEntityId_fromType_idx" ON "EntityLink"("tenantId", "fromEntityId", "fromType");

-- CreateIndex
CREATE INDEX "EntityLink_tenantId_toEntityId_toType_idx" ON "EntityLink"("tenantId", "toEntityId", "toType");

-- CreateIndex
CREATE INDEX "EntityLink_tenantId_relationType_validFrom_idx" ON "EntityLink"("tenantId", "relationType", "validFrom");

-- CreateIndex
CREATE INDEX "EntityLink_tenantId_deletedAt_idx" ON "EntityLink"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "EntityLink_tenantId_validUntil_idx" ON "EntityLink"("tenantId", "validUntil");

-- CreateIndex
CREATE INDEX "EntityLink_fromEntityId_validFrom_validUntil_idx" ON "EntityLink"("fromEntityId", "validFrom", "validUntil");

-- CreateIndex
CREATE INDEX "EntityLink_toEntityId_validFrom_validUntil_idx" ON "EntityLink"("toEntityId", "validFrom", "validUntil");

-- CreateIndex
CREATE UNIQUE INDEX "EntityLink_fromEntityId_fromType_toEntityId_toType_relation_key" ON "EntityLink"("fromEntityId", "fromType", "toEntityId", "toType", "relationType");

-- CreateIndex
CREATE INDEX "Theme_tenantId_status_idx" ON "Theme"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Theme_tenantId_branch_idx" ON "Theme"("tenantId", "branch");

-- CreateIndex
CREATE INDEX "Theme_tenantId_mergedIntoId_idx" ON "Theme"("tenantId", "mergedIntoId");

-- CreateIndex
CREATE INDEX "ThemeIdeaBlock_blockId_idx" ON "ThemeIdeaBlock"("blockId");

-- CreateIndex
CREATE INDEX "ThemeEntity_entityId_idx" ON "ThemeEntity"("entityId");

-- CreateIndex
CREATE INDEX "SuperAdminAccessLog_superAdminUserId_createdAt_idx" ON "SuperAdminAccessLog"("superAdminUserId", "createdAt");

-- CreateIndex
CREATE INDEX "SuperAdminAccessLog_accessedTenantId_createdAt_idx" ON "SuperAdminAccessLog"("accessedTenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Goal_entityId_key" ON "Goal"("entityId");

-- CreateIndex
CREATE INDEX "Goal_tenantId_status_idx" ON "Goal"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Goal_tenantId_archivedAt_idx" ON "Goal"("tenantId", "archivedAt");

-- CreateIndex
CREATE INDEX "Goal_tenantId_horizon_idx" ON "Goal"("tenantId", "horizon");

-- CreateIndex
CREATE INDEX "Goal_tenantId_parentGoalId_idx" ON "Goal"("tenantId", "parentGoalId");

-- CreateIndex
CREATE INDEX "Goal_tenantId_promotionState_idx" ON "Goal"("tenantId", "promotionState");

-- CreateIndex
CREATE INDEX "Goal_tenantId_validUntil_idx" ON "Goal"("tenantId", "validUntil");

-- CreateIndex
CREATE INDEX "GoalTheme_themeId_idx" ON "GoalTheme"("themeId");

-- CreateIndex
CREATE INDEX "GoalAlignmentSnapshot_goalId_createdAt_idx" ON "GoalAlignmentSnapshot"("goalId", "createdAt");

-- CreateIndex
CREATE INDEX "GoalAlignmentSnapshot_tenantId_createdAt_idx" ON "GoalAlignmentSnapshot"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "GoalAlignmentSnapshot_tenantId_alertPending_idx" ON "GoalAlignmentSnapshot"("tenantId", "alertPending");

-- CreateIndex
CREATE INDEX "GoalKeyResult_tenantId_goalId_idx" ON "GoalKeyResult"("tenantId", "goalId");

-- CreateIndex
CREATE INDEX "GoalKeyResult_goalId_idx" ON "GoalKeyResult"("goalId");

-- CreateIndex
CREATE INDEX "GoalKeyResultCheckpoint_keyResultId_createdAt_idx" ON "GoalKeyResultCheckpoint"("keyResultId", "createdAt");

-- CreateIndex
CREATE INDEX "GoalKeyResultCheckpoint_tenantId_createdAt_idx" ON "GoalKeyResultCheckpoint"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "weekly_goals_pulse_digests_tenantId_isoWeek_idx" ON "weekly_goals_pulse_digests"("tenantId", "isoWeek");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_goals_pulse_digests_tenantId_isoWeek_key" ON "weekly_goals_pulse_digests"("tenantId", "isoWeek");

-- CreateIndex
CREATE UNIQUE INDEX "OrgRetentionPolicy_tenantId_key" ON "OrgRetentionPolicy"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgEntitlement_tenantId_key" ON "OrgEntitlement"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "departments_entityId_key" ON "departments"("entityId");

-- CreateIndex
CREATE INDEX "departments_tenantId_idx" ON "departments"("tenantId");

-- CreateIndex
CREATE INDEX "departments_tenantId_parentDepartmentId_idx" ON "departments"("tenantId", "parentDepartmentId");

-- CreateIndex
CREATE INDEX "departments_tenantId_headPersonId_idx" ON "departments"("tenantId", "headPersonId");

-- CreateIndex
CREATE UNIQUE INDEX "departments_tenantId_name_deletedAt_key" ON "departments"("tenantId", "name", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "roles_entityId_key" ON "roles"("entityId");

-- CreateIndex
CREATE INDEX "roles_tenantId_departmentId_idx" ON "roles"("tenantId", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenantId_name_deletedAt_key" ON "roles"("tenantId", "name", "deletedAt");

-- CreateIndex
CREATE INDEX "persons_tenantId_userId_idx" ON "persons"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "persons_tenantId_primaryDepartmentId_idx" ON "persons"("tenantId", "primaryDepartmentId");

-- CreateIndex
CREATE INDEX "persons_tenantId_entityId_idx" ON "persons"("tenantId", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "persons_tenantId_email_deletedAt_key" ON "persons"("tenantId", "email", "deletedAt");

-- CreateIndex
CREATE INDEX "person_knowledge_category_embeddings_tenantId_confidence_idx" ON "person_knowledge_category_embeddings"("tenantId", "confidence");

-- CreateIndex
CREATE INDEX "person_knowledge_category_embeddings_personId_idx" ON "person_knowledge_category_embeddings"("personId");

-- CreateIndex
CREATE INDEX "person_roles_tenantId_roleId_idx" ON "person_roles"("tenantId", "roleId");

-- CreateIndex
CREATE INDEX "person_roles_tenantId_personId_idx" ON "person_roles"("tenantId", "personId");

-- CreateIndex
CREATE INDEX "person_roles_tenantId_validTo_idx" ON "person_roles"("tenantId", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "person_roles_personId_roleId_validFrom_key" ON "person_roles"("personId", "roleId", "validFrom");

-- CreateIndex
CREATE INDEX "appointments_tenantId_personId_status_idx" ON "appointments"("tenantId", "personId", "status");

-- CreateIndex
CREATE INDEX "appointments_tenantId_roleId_status_idx" ON "appointments"("tenantId", "roleId", "status");

-- CreateIndex
CREATE INDEX "appointments_tenantId_departmentId_status_idx" ON "appointments"("tenantId", "departmentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_tenantId_personId_roleId_validFrom_key" ON "appointments"("tenantId", "personId", "roleId", "validFrom");

-- CreateIndex
CREATE INDEX "job_descriptions_tenantId_roleId_idx" ON "job_descriptions"("tenantId", "roleId");

-- CreateIndex
CREATE INDEX "skills_tenantId_idx" ON "skills"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "skills_tenantId_name_deletedAt_key" ON "skills"("tenantId", "name", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "documents_entityId_key" ON "documents"("entityId");

-- CreateIndex
CREATE INDEX "documents_tenantId_status_idx" ON "documents"("tenantId", "status");

-- CreateIndex
CREATE INDEX "documents_tenantId_uploaderId_idx" ON "documents"("tenantId", "uploaderId");

-- CreateIndex
CREATE INDEX "documents_tenantId_attachedRoleId_idx" ON "documents"("tenantId", "attachedRoleId");

-- CreateIndex
CREATE UNIQUE INDEX "brand_voice_profiles_tenantId_key" ON "brand_voice_profiles"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "role_profiles_roleId_key" ON "role_profiles"("roleId");

-- CreateIndex
CREATE INDEX "role_profiles_tenantId_status_idx" ON "role_profiles"("tenantId", "status");

-- CreateIndex
CREATE INDEX "responsibility_elements_tenantId_roleId_idx" ON "responsibility_elements"("tenantId", "roleId");

-- CreateIndex
CREATE INDEX "responsibility_elements_tenantId_roleId_kind_idx" ON "responsibility_elements"("tenantId", "roleId", "kind");

-- CreateIndex
CREATE INDEX "responsibility_elements_parentId_idx" ON "responsibility_elements"("parentId");

-- CreateIndex
CREATE INDEX "authority_boundaries_tenantId_roleId_idx" ON "authority_boundaries"("tenantId", "roleId");

-- CreateIndex
CREATE INDEX "authority_boundaries_tenantId_kind_idx" ON "authority_boundaries"("tenantId", "kind");

-- CreateIndex
CREATE INDEX "required_knowledge_tenantId_roleId_idx" ON "required_knowledge"("tenantId", "roleId");

-- CreateIndex
CREATE INDEX "required_knowledge_tenantId_roleId_importance_idx" ON "required_knowledge"("tenantId", "roleId", "importance");

-- CreateIndex
CREATE INDEX "decision_policies_tenantId_roleId_idx" ON "decision_policies"("tenantId", "roleId");

-- CreateIndex
CREATE INDEX "interactions_tenantId_roleId_idx" ON "interactions"("tenantId", "roleId");

-- CreateIndex
CREATE INDEX "interactions_tenantId_counterpartRoleId_idx" ON "interactions"("tenantId", "counterpartRoleId");

-- CreateIndex
CREATE INDEX "interactions_tenantId_kind_idx" ON "interactions"("tenantId", "kind");

-- CreateIndex
CREATE INDEX "missions_tenantId_idx" ON "missions"("tenantId");

-- CreateIndex
CREATE INDEX "visions_tenantId_idx" ON "visions"("tenantId");

-- CreateIndex
CREATE INDEX "strategies_tenantId_idx" ON "strategies"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "company_profiles_tenantId_key" ON "company_profiles"("tenantId");

-- CreateIndex
CREATE INDEX "company_profiles_tenantId_idx" ON "company_profiles"("tenantId");

-- CreateIndex
CREATE INDEX "functional_domains_tenantId_parentDomainId_idx" ON "functional_domains"("tenantId", "parentDomainId");

-- CreateIndex
CREATE INDEX "functional_domains_tenantId_isSystem_idx" ON "functional_domains"("tenantId", "isSystem");

-- CreateIndex
CREATE UNIQUE INDEX "functional_domains_tenantId_slug_key" ON "functional_domains"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "department_domain_links_tenantId_domainId_idx" ON "department_domain_links"("tenantId", "domainId");

-- CreateIndex
CREATE INDEX "department_domain_links_tenantId_departmentId_idx" ON "department_domain_links"("tenantId", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "department_domain_links_departmentId_domainId_key" ON "department_domain_links"("departmentId", "domainId");

-- CreateIndex
CREATE UNIQUE INDEX "processes_entityId_key" ON "processes"("entityId");

-- CreateIndex
CREATE INDEX "processes_tenantId_status_idx" ON "processes"("tenantId", "status");

-- CreateIndex
CREATE INDEX "processes_tenantId_ownerRoleId_idx" ON "processes"("tenantId", "ownerRoleId");

-- CreateIndex
CREATE INDEX "processes_tenantId_scope_idx" ON "processes"("tenantId", "scope");

-- CreateIndex
CREATE INDEX "processes_tenantId_templateId_idx" ON "processes"("tenantId", "templateId");

-- CreateIndex
CREATE INDEX "processes_currentVersionId_idx" ON "processes"("currentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "processes_tenantId_name_key" ON "processes"("tenantId", "name");

-- CreateIndex
CREATE INDEX "process_templates_tenantId_status_idx" ON "process_templates"("tenantId", "status");

-- CreateIndex
CREATE INDEX "process_templates_tenantId_category_idx" ON "process_templates"("tenantId", "category");

-- CreateIndex
CREATE INDEX "process_templates_tenantId_scope_idx" ON "process_templates"("tenantId", "scope");

-- CreateIndex
CREATE INDEX "process_templates_tenantId_isCrossFunctional_idx" ON "process_templates"("tenantId", "isCrossFunctional");

-- CreateIndex
CREATE UNIQUE INDEX "process_templates_tenantId_name_key" ON "process_templates"("tenantId", "name");

-- CreateIndex
CREATE INDEX "cross_functional_friction_reports_tenantId_severity_resolve_idx" ON "cross_functional_friction_reports"("tenantId", "severity", "resolvedAt");

-- CreateIndex
CREATE INDEX "cross_functional_friction_reports_tenantId_processTemplateI_idx" ON "cross_functional_friction_reports"("tenantId", "processTemplateId");

-- CreateIndex
CREATE INDEX "process_template_versions_tenantId_templateId_idx" ON "process_template_versions"("tenantId", "templateId");

-- CreateIndex
CREATE UNIQUE INDEX "process_template_versions_templateId_version_key" ON "process_template_versions"("templateId", "version");

-- CreateIndex
CREATE INDEX "decision_points_tenantId_templateId_idx" ON "decision_points"("tenantId", "templateId");

-- CreateIndex
CREATE INDEX "decision_points_tenantId_processStepId_idx" ON "decision_points"("tenantId", "processStepId");

-- CreateIndex
CREATE INDEX "process_handoffs_tenantId_kind_idx" ON "process_handoffs"("tenantId", "kind");

-- CreateIndex
CREATE INDEX "process_handoffs_tenantId_fromTemplateId_idx" ON "process_handoffs"("tenantId", "fromTemplateId");

-- CreateIndex
CREATE INDEX "process_handoffs_tenantId_toTemplateId_idx" ON "process_handoffs"("tenantId", "toTemplateId");

-- CreateIndex
CREATE INDEX "process_handoffs_tenantId_fromRoleId_idx" ON "process_handoffs"("tenantId", "fromRoleId");

-- CreateIndex
CREATE INDEX "process_handoffs_tenantId_toRoleId_idx" ON "process_handoffs"("tenantId", "toRoleId");

-- CreateIndex
CREATE INDEX "process_steps_tenantId_processId_idx" ON "process_steps"("tenantId", "processId");

-- CreateIndex
CREATE UNIQUE INDEX "process_steps_processId_order_key" ON "process_steps"("processId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "regulations_entityId_key" ON "regulations"("entityId");

-- CreateIndex
CREATE INDEX "regulations_tenantId_category_idx" ON "regulations"("tenantId", "category");

-- CreateIndex
CREATE INDEX "regulations_tenantId_status_idx" ON "regulations"("tenantId", "status");

-- CreateIndex
CREATE INDEX "regulations_tenantId_scope_idx" ON "regulations"("tenantId", "scope");

-- CreateIndex
CREATE INDEX "regulations_tenantId_ownerPersonId_idx" ON "regulations"("tenantId", "ownerPersonId");

-- CreateIndex
CREATE INDEX "regulations_currentVersionId_idx" ON "regulations"("currentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "regulations_tenantId_name_key" ON "regulations"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "policies_entityId_key" ON "policies"("entityId");

-- CreateIndex
CREATE INDEX "policies_tenantId_severity_idx" ON "policies"("tenantId", "severity");

-- CreateIndex
CREATE INDEX "policies_tenantId_status_idx" ON "policies"("tenantId", "status");

-- CreateIndex
CREATE INDEX "policies_tenantId_scope_idx" ON "policies"("tenantId", "scope");

-- CreateIndex
CREATE INDEX "policies_tenantId_ownerPersonId_idx" ON "policies"("tenantId", "ownerPersonId");

-- CreateIndex
CREATE INDEX "policies_currentVersionId_idx" ON "policies"("currentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "policies_tenantId_name_key" ON "policies"("tenantId", "name");

-- CreateIndex
CREATE INDEX "tools_tenantId_idx" ON "tools"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tools_tenantId_name_key" ON "tools"("tenantId", "name");

-- CreateIndex
CREATE INDEX "metrics_tenantId_idx" ON "metrics"("tenantId");

-- CreateIndex
CREATE INDEX "metrics_tenantId_attachedToRoleId_idx" ON "metrics"("tenantId", "attachedToRoleId");

-- CreateIndex
CREATE INDEX "metrics_tenantId_attachedToDepartmentId_idx" ON "metrics"("tenantId", "attachedToDepartmentId");

-- CreateIndex
CREATE INDEX "metrics_tenantId_attachedToResponsibilityElementId_idx" ON "metrics"("tenantId", "attachedToResponsibilityElementId");

-- CreateIndex
CREATE UNIQUE INDEX "metrics_tenantId_name_key" ON "metrics"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "decisions_sourceIdeaBlockId_key" ON "decisions"("sourceIdeaBlockId");

-- CreateIndex
CREATE UNIQUE INDEX "decisions_entityId_key" ON "decisions"("entityId");

-- CreateIndex
CREATE INDEX "decisions_tenantId_status_idx" ON "decisions"("tenantId", "status");

-- CreateIndex
CREATE INDEX "decisions_tenantId_decidedAt_idx" ON "decisions"("tenantId", "decidedAt");

-- CreateIndex
CREATE INDEX "decisions_tenantId_decidedByPersonId_idx" ON "decisions"("tenantId", "decidedByPersonId");

-- CreateIndex
CREATE INDEX "decisions_tenantId_deadline_idx" ON "decisions"("tenantId", "deadline");

-- CreateIndex
CREATE INDEX "decisions_supersedesId_idx" ON "decisions"("supersedesId");

-- CreateIndex
CREATE INDEX "decisions_currentVersionId_idx" ON "decisions"("currentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "insights_entityId_key" ON "insights"("entityId");

-- CreateIndex
CREATE INDEX "insights_tenantId_status_severity_idx" ON "insights"("tenantId", "status", "severity");

-- CreateIndex
CREATE INDEX "insights_tenantId_kind_idx" ON "insights"("tenantId", "kind");

-- CreateIndex
CREATE INDEX "insights_tenantId_dynamicLabel_idx" ON "insights"("tenantId", "dynamicLabel");

-- CreateIndex
CREATE INDEX "insights_tenantId_lastObservedAt_idx" ON "insights"("tenantId", "lastObservedAt");

-- CreateIndex
CREATE INDEX "insights_tenantId_causeCategory_idx" ON "insights"("tenantId", "causeCategory");

-- CreateIndex
CREATE INDEX "insights_currentVersionId_idx" ON "insights"("currentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ideas_entityId_key" ON "ideas"("entityId");

-- CreateIndex
CREATE INDEX "ideas_tenantId_status_kind_idx" ON "ideas"("tenantId", "status", "kind");

-- CreateIndex
CREATE INDEX "ideas_tenantId_weight_idx" ON "ideas"("tenantId", "weight");

-- CreateIndex
CREATE INDEX "ideas_tenantId_createdByUserId_idx" ON "ideas"("tenantId", "createdByUserId");

-- CreateIndex
CREATE INDEX "ideas_tenantId_clusterId_idx" ON "ideas"("tenantId", "clusterId");

-- CreateIndex
CREATE INDEX "ideas_currentVersionId_idx" ON "ideas"("currentVersionId");

-- CreateIndex
CREATE INDEX "ideas_tenantId_goalId_idx" ON "ideas"("tenantId", "goalId");

-- CreateIndex
CREATE INDEX "idea_clusters_tenantId_idx" ON "idea_clusters"("tenantId");

-- CreateIndex
CREATE INDEX "probe_events_tenantId_status_idx" ON "probe_events"("tenantId", "status");

-- CreateIndex
CREATE INDEX "probe_events_tenantId_emittedByService_idx" ON "probe_events"("tenantId", "emittedByService");

-- CreateIndex
CREATE INDEX "probe_events_contentHash_idx" ON "probe_events"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "PromptTemplate_activeVersionId_key" ON "PromptTemplate"("activeVersionId");

-- CreateIndex
CREATE INDEX "PromptTemplate_scope_status_idx" ON "PromptTemplate"("scope", "status");

-- CreateIndex
CREATE INDEX "PromptTemplate_orgId_status_idx" ON "PromptTemplate"("orgId", "status");

-- CreateIndex
CREATE INDEX "PromptTemplate_taskType_meetingType_status_idx" ON "PromptTemplate"("taskType", "meetingType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PromptTemplate_orgId_key_key" ON "PromptTemplate"("orgId", "key");

-- CreateIndex
CREATE INDEX "PromptTemplateVersion_templateId_idx" ON "PromptTemplateVersion"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "PromptTemplateVersion_templateId_versionNumber_key" ON "PromptTemplateVersion"("templateId", "versionNumber");

-- CreateIndex
CREATE INDEX "PromptTemplateSection_versionId_idx" ON "PromptTemplateSection"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "PromptTemplateSection_versionId_key_key" ON "PromptTemplateSection"("versionId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "PromptTemplateSection_versionId_order_key" ON "PromptTemplateSection"("versionId", "order");

-- CreateIndex
CREATE INDEX "PromptExperiment_orgId_status_idx" ON "PromptExperiment"("orgId", "status");

-- CreateIndex
CREATE INDEX "PromptExperiment_status_idx" ON "PromptExperiment"("status");

-- CreateIndex
CREATE INDEX "AiResultFeedback_aiResultId_idx" ON "AiResultFeedback"("aiResultId");

-- CreateIndex
CREATE INDEX "AiResultFeedback_userId_idx" ON "AiResultFeedback"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AiResultFeedback_aiResultId_userId_key" ON "AiResultFeedback"("aiResultId", "userId");

-- CreateIndex
CREATE INDEX "MeetingReport_meetingId_status_idx" ON "MeetingReport"("meetingId", "status");

-- CreateIndex
CREATE INDEX "MeetingReport_meetingId_deletedAt_idx" ON "MeetingReport"("meetingId", "deletedAt");

-- CreateIndex
CREATE INDEX "MeetingReport_tenantId_createdAt_idx" ON "MeetingReport"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "MeetingReport_promptTemplateId_idx" ON "MeetingReport"("promptTemplateId");

-- CreateIndex
CREATE INDEX "MeetingReport_promptTemplateVersionId_idx" ON "MeetingReport"("promptTemplateVersionId");

-- CreateIndex
CREATE INDEX "channels_tenantId_kind_idx" ON "channels"("tenantId", "kind");

-- CreateIndex
CREATE INDEX "channels_tenantId_status_idx" ON "channels"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "channels_tenantId_kind_key" ON "channels"("tenantId", "kind");

-- CreateIndex
CREATE INDEX "channel_bindings_userId_idx" ON "channel_bindings"("userId");

-- CreateIndex
CREATE INDEX "channel_bindings_channelId_idx" ON "channel_bindings"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_bindings_channelId_externalId_key" ON "channel_bindings"("channelId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_bindings_userId_channelId_key" ON "channel_bindings"("userId", "channelId");

-- CreateIndex
CREATE INDEX "notifications_tenantId_recipientUserId_status_idx" ON "notifications"("tenantId", "recipientUserId", "status");

-- CreateIndex
CREATE INDEX "notifications_tenantId_eventType_status_idx" ON "notifications"("tenantId", "eventType", "status");

-- CreateIndex
CREATE INDEX "notifications_recipientUserId_status_idx" ON "notifications"("recipientUserId", "status");

-- CreateIndex
CREATE INDEX "notifications_expiresAt_idx" ON "notifications"("expiresAt");

-- CreateIndex
CREATE INDEX "notification_deliveries_notificationId_idx" ON "notification_deliveries"("notificationId");

-- CreateIndex
CREATE INDEX "notification_deliveries_channelBindingId_status_idx" ON "notification_deliveries"("channelBindingId", "status");

-- CreateIndex
CREATE INDEX "daily_check_ins_tenantId_personId_dateLocal_idx" ON "daily_check_ins"("tenantId", "personId", "dateLocal");

-- CreateIndex
CREATE INDEX "daily_check_ins_tenantId_kind_dateLocal_idx" ON "daily_check_ins"("tenantId", "kind", "dateLocal");

-- CreateIndex
CREATE INDEX "daily_check_ins_tenantId_curatorReview_idx" ON "daily_check_ins"("tenantId", "curatorReview");

-- CreateIndex
CREATE INDEX "daily_check_ins_tenantId_sentiment_dateLocal_idx" ON "daily_check_ins"("tenantId", "sentiment", "dateLocal");

-- CreateIndex
CREATE UNIQUE INDEX "daily_check_ins_tenantId_personId_kind_dateLocal_key" ON "daily_check_ins"("tenantId", "personId", "kind", "dateLocal");

-- CreateIndex
CREATE INDEX "person_engagement_snapshots_tenantId_personId_snapshotAt_idx" ON "person_engagement_snapshots"("tenantId", "personId", "snapshotAt");

-- CreateIndex
CREATE INDEX "person_engagement_snapshots_tenantId_snapshotAt_idx" ON "person_engagement_snapshots"("tenantId", "snapshotAt");

-- CreateIndex
CREATE INDEX "forecast_snapshots_tenantId_scope_snapshotAt_idx" ON "forecast_snapshots"("tenantId", "scope", "snapshotAt" DESC);

-- CreateIndex
CREATE INDEX "forecast_snapshots_scopeId_idx" ON "forecast_snapshots"("scopeId");

-- CreateIndex
CREATE INDEX "knowledge_risk_snapshots_tenantId_riskLevel_snapshotAt_idx" ON "knowledge_risk_snapshots"("tenantId", "riskLevel", "snapshotAt" DESC);

-- CreateIndex
CREATE INDEX "knowledge_risk_snapshots_tenantId_categoryName_snapshotAt_idx" ON "knowledge_risk_snapshots"("tenantId", "categoryName", "snapshotAt" DESC);

-- CreateIndex
CREATE INDEX "recurring_topics_tenantId_snapshotAt_idx" ON "recurring_topics"("tenantId", "snapshotAt" DESC);

-- CreateIndex
CREATE INDEX "recurring_topics_tenantId_mentionCount_idx" ON "recurring_topics"("tenantId", "mentionCount" DESC);

-- CreateIndex
CREATE INDEX "promise_network_snapshots_tenantId_snapshotAt_idx" ON "promise_network_snapshots"("tenantId", "snapshotAt" DESC);

-- CreateIndex
CREATE INDEX "person_goal_contributions_tenantId_personId_weekStart_idx" ON "person_goal_contributions"("tenantId", "personId", "weekStart" DESC);

-- CreateIndex
CREATE INDEX "person_goal_contributions_tenantId_goalId_weekStart_idx" ON "person_goal_contributions"("tenantId", "goalId", "weekStart" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "person_goal_contributions_tenantId_personId_goalId_weekStar_key" ON "person_goal_contributions"("tenantId", "personId", "goalId", "weekStart");

-- CreateIndex
CREATE INDEX "knowledge_velocity_snapshots_tenantId_snapshotAt_idx" ON "knowledge_velocity_snapshots"("tenantId", "snapshotAt" DESC);

-- CreateIndex
CREATE INDEX "weekly_operations_digests_tenantId_weekStart_idx" ON "weekly_operations_digests"("tenantId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_operations_digests_tenantId_weekStart_key" ON "weekly_operations_digests"("tenantId", "weekStart");

-- CreateIndex
CREATE INDEX "daily_operations_digests_tenantId_dateLocal_idx" ON "daily_operations_digests"("tenantId", "dateLocal");

-- CreateIndex
CREATE UNIQUE INDEX "daily_operations_digests_tenantId_dateLocal_key" ON "daily_operations_digests"("tenantId", "dateLocal");

-- CreateIndex
CREATE INDEX "proactive_notifications_tenantId_userId_emittedAt_idx" ON "proactive_notifications"("tenantId", "userId", "emittedAt");

-- CreateIndex
CREATE INDEX "proactive_notifications_tenantId_ruleType_emittedAt_idx" ON "proactive_notifications"("tenantId", "ruleType", "emittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingBehaviorMetrics_meetingId_key" ON "MeetingBehaviorMetrics"("meetingId");

-- CreateIndex
CREATE INDEX "MeetingBehaviorMetrics_tenantId_idx" ON "MeetingBehaviorMetrics"("tenantId");

-- CreateIndex
CREATE INDEX "MeetingParticipantBehavior_tenantId_idx" ON "MeetingParticipantBehavior"("tenantId");

-- CreateIndex
CREATE INDEX "MeetingParticipantBehavior_participantId_idx" ON "MeetingParticipantBehavior"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingParticipantBehavior_meetingBehaviorMetricsId_partici_key" ON "MeetingParticipantBehavior"("meetingBehaviorMetricsId", "participantId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingQualityScore_meetingId_key" ON "MeetingQualityScore"("meetingId");

-- CreateIndex
CREATE INDEX "MeetingQualityScore_tenantId_idx" ON "MeetingQualityScore"("tenantId");

-- CreateIndex
CREATE INDEX "MeetingQualityScore_tenantId_overallScore_idx" ON "MeetingQualityScore"("tenantId", "overallScore");

-- CreateIndex
CREATE INDEX "MeetingQualityScore_tenantId_computedAt_idx" ON "MeetingQualityScore"("tenantId", "computedAt");

-- CreateIndex
CREATE INDEX "ChatV2Conversation_tenantId_userId_updatedAt_idx" ON "ChatV2Conversation"("tenantId", "userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ChatV2Conversation_tenantId_status_idx" ON "ChatV2Conversation"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ChatV2Message_conversationId_createdAt_idx" ON "ChatV2Message"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "skill_profiles_personId_key" ON "skill_profiles"("personId");

-- CreateIndex
CREATE INDEX "skill_profiles_tenantId_status_idx" ON "skill_profiles"("tenantId", "status");

-- CreateIndex
CREATE INDEX "skill_traits_profileId_status_idx" ON "skill_traits"("profileId", "status");

-- CreateIndex
CREATE INDEX "skill_traits_profileId_category_idx" ON "skill_traits"("profileId", "category");

-- CreateIndex
CREATE INDEX "skill_traits_profileId_categoryId_idx" ON "skill_traits"("profileId", "categoryId");

-- CreateIndex
CREATE INDEX "skill_traits_categoryId_idx" ON "skill_traits"("categoryId");

-- CreateIndex
CREATE INDEX "skill_traits_conceptId_idx" ON "skill_traits"("conceptId");

-- CreateIndex
CREATE INDEX "skill_trait_concepts_tenantId_status_idx" ON "skill_trait_concepts"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "skill_trait_concepts_tenantId_canonicalName_key" ON "skill_trait_concepts"("tenantId", "canonicalName");

-- CreateIndex
CREATE INDEX "practice_skills_tenantId_scope_scopeRefId_status_idx" ON "practice_skills"("tenantId", "scope", "scopeRefId", "status");

-- CreateIndex
CREATE INDEX "practice_skills_tenantId_status_lastUsed_idx" ON "practice_skills"("tenantId", "status", "lastUsed");

-- CreateIndex
CREATE INDEX "skill_usages_practiceSkillId_createdAt_idx" ON "skill_usages"("practiceSkillId", "createdAt");

-- CreateIndex
CREATE INDEX "skill_usages_conversationId_idx" ON "skill_usages"("conversationId");

-- CreateIndex
CREATE INDEX "skill_usages_tenantId_createdAt_idx" ON "skill_usages"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "skill_trait_categories_tenantId_deletedAt_idx" ON "skill_trait_categories"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "skill_trait_categories_parentCategoryId_idx" ON "skill_trait_categories"("parentCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "skill_trait_categories_tenantId_slug_key" ON "skill_trait_categories"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "executable_personas_scope_scopeRefId_status_idx" ON "executable_personas"("scope", "scopeRefId", "status");

-- CreateIndex
CREATE INDEX "executable_personas_tenantId_idx" ON "executable_personas"("tenantId");

-- CreateIndex
CREATE INDEX "executable_personas_scope_scopeRefId_status_roleVersion_idx" ON "executable_personas"("scope", "scopeRefId", "status", "roleVersion");

-- CreateIndex
CREATE UNIQUE INDEX "executable_personas_profileId_scope_scopeRefId_version_key" ON "executable_personas"("profileId", "scope", "scopeRefId", "version");

-- CreateIndex
CREATE INDEX "experiments_tenantId_status_idx" ON "experiments"("tenantId", "status");

-- CreateIndex
CREATE INDEX "experiments_tenantId_ownerEntityId_idx" ON "experiments"("tenantId", "ownerEntityId");

-- CreateIndex
CREATE INDEX "experiments_tenantId_updatedAt_idx" ON "experiments"("tenantId", "updatedAt");

-- CreateIndex
CREATE INDEX "experiment_versions_tenantId_experimentId_idx" ON "experiment_versions"("tenantId", "experimentId");

-- CreateIndex
CREATE UNIQUE INDEX "experiment_versions_experimentId_versionNumber_key" ON "experiment_versions"("experimentId", "versionNumber");

-- CreateIndex
CREATE INDEX "concierge_conversations_tenantId_userId_lastMessageAt_idx" ON "concierge_conversations"("tenantId", "userId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "concierge_conversations_tenantId_archivedAt_idx" ON "concierge_conversations"("tenantId", "archivedAt");

-- CreateIndex
CREATE INDEX "concierge_messages_conversationId_createdAt_idx" ON "concierge_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "concierge_undo_logs_tenantId_executedAt_idx" ON "concierge_undo_logs"("tenantId", "executedAt");

-- CreateIndex
CREATE INDEX "concierge_undo_logs_conversationId_executedAt_idx" ON "concierge_undo_logs"("conversationId", "executedAt");

-- CreateIndex
CREATE INDEX "orchestrator_runs_tenantId_userId_startedAt_idx" ON "orchestrator_runs"("tenantId", "userId", "startedAt");

-- CreateIndex
CREATE INDEX "orchestrator_runs_status_idx" ON "orchestrator_runs"("status");

-- CreateIndex
CREATE INDEX "orchestrator_subagent_jobs_runId_stepIndex_idx" ON "orchestrator_subagent_jobs"("runId", "stepIndex");

-- CreateIndex
CREATE INDEX "orchestrator_subagent_jobs_status_idx" ON "orchestrator_subagent_jobs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Project_emailInboxAlias_key" ON "Project"("emailInboxAlias");

-- CreateIndex
CREATE INDEX "Project_tenantId_archivedAt_idx" ON "Project"("tenantId", "archivedAt");

-- CreateIndex
CREATE INDEX "Project_tenantId_identifier_idx" ON "Project"("tenantId", "identifier");

-- CreateIndex
CREATE INDEX "Project_tenantId_customerCardId_idx" ON "Project"("tenantId", "customerCardId");

-- CreateIndex
CREATE INDEX "Project_tenantId_vendorId_idx" ON "Project"("tenantId", "vendorId");

-- CreateIndex
CREATE INDEX "Project_tenantId_subjectPersonId_idx" ON "Project"("tenantId", "subjectPersonId");

-- CreateIndex
CREATE INDEX "Project_tenantId_departmentId_idx" ON "Project"("tenantId", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_tenantId_slug_key" ON "Project"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "ProjectDocument_projectId_sortOrder_idx" ON "ProjectDocument"("projectId", "sortOrder");

-- CreateIndex
CREATE INDEX "ProjectDocument_projectId_deletedAt_idx" ON "ProjectDocument"("projectId", "deletedAt");

-- CreateIndex
CREATE INDEX "ProjectDocument_tenantId_idx" ON "ProjectDocument"("tenantId");

-- CreateIndex
CREATE INDEX "ProjectDocument_parentId_idx" ON "ProjectDocument"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectDocument_projectId_title_key" ON "ProjectDocument"("projectId", "title");

-- CreateIndex
CREATE INDEX "Board_projectId_sequence_idx" ON "Board"("projectId", "sequence");

-- CreateIndex
CREATE INDEX "Board_tenantId_idx" ON "Board"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Board_projectId_name_key" ON "Board"("projectId", "name");

-- CreateIndex
CREATE INDEX "ProjectMember_userId_idx" ON "ProjectMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "ProjectMember"("projectId", "userId");

-- CreateIndex
CREATE INDEX "IssueState_projectId_sequence_idx" ON "IssueState"("projectId", "sequence");

-- CreateIndex
CREATE INDEX "IssueState_tenantId_idx" ON "IssueState"("tenantId");

-- CreateIndex
CREATE INDEX "Cycle_projectId_startDate_idx" ON "Cycle"("projectId", "startDate");

-- CreateIndex
CREATE INDEX "Cycle_tenantId_idx" ON "Cycle"("tenantId");

-- CreateIndex
CREATE INDEX "Cycle_tenantId_completedAt_idx" ON "Cycle"("tenantId", "completedAt");

-- CreateIndex
CREATE INDEX "Cycle_tenantId_primaryGoalId_idx" ON "Cycle"("tenantId", "primaryGoalId");

-- CreateIndex
CREATE INDEX "SprintHint_tenantId_cycleId_status_idx" ON "SprintHint"("tenantId", "cycleId", "status");

-- CreateIndex
CREATE INDEX "SprintHint_tenantId_status_createdAt_idx" ON "SprintHint"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SprintHint_cycleId_kind_contentHash_idx" ON "SprintHint"("cycleId", "kind", "contentHash");

-- CreateIndex
CREATE INDEX "Issue_tenantId_stateId_deletedAt_idx" ON "Issue"("tenantId", "stateId", "deletedAt");

-- CreateIndex
CREATE INDEX "Issue_tenantId_dueDate_idx" ON "Issue"("tenantId", "dueDate");

-- CreateIndex
CREATE INDEX "Issue_tenantId_goalId_idx" ON "Issue"("tenantId", "goalId");

-- CreateIndex
CREATE INDEX "Issue_tenantId_cycleId_idx" ON "Issue"("tenantId", "cycleId");

-- CreateIndex
CREATE INDEX "Issue_tenantId_projectId_deletedAt_idx" ON "Issue"("tenantId", "projectId", "deletedAt");

-- CreateIndex
CREATE INDEX "Issue_parentId_idx" ON "Issue"("parentId");

-- CreateIndex
CREATE INDEX "Issue_boardId_idx" ON "Issue"("boardId");

-- CreateIndex
CREATE UNIQUE INDEX "Issue_projectId_sequenceId_key" ON "Issue"("projectId", "sequenceId");

-- CreateIndex
CREATE UNIQUE INDEX "Issue_tenantId_identifier_key" ON "Issue"("tenantId", "identifier");

-- CreateIndex
CREATE INDEX "IssueAssignee_userId_idx" ON "IssueAssignee"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "IssueAssignee_issueId_userId_key" ON "IssueAssignee"("issueId", "userId");

-- CreateIndex
CREATE INDEX "Label_projectId_idx" ON "Label"("projectId");

-- CreateIndex
CREATE INDEX "Label_tenantId_idx" ON "Label"("tenantId");

-- CreateIndex
CREATE INDEX "IssueLabel_labelId_idx" ON "IssueLabel"("labelId");

-- CreateIndex
CREATE UNIQUE INDEX "IssueLabel_issueId_labelId_key" ON "IssueLabel"("issueId", "labelId");

-- CreateIndex
CREATE INDEX "IssueSubscriber_userId_idx" ON "IssueSubscriber"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "IssueSubscriber_issueId_userId_key" ON "IssueSubscriber"("issueId", "userId");

-- CreateIndex
CREATE INDEX "IssueMention_mentionedUserId_idx" ON "IssueMention"("mentionedUserId");

-- CreateIndex
CREATE INDEX "IssueMention_issueId_idx" ON "IssueMention"("issueId");

-- CreateIndex
CREATE INDEX "IssueMention_commentId_idx" ON "IssueMention"("commentId");

-- CreateIndex
CREATE INDEX "IssueComment_issueId_createdAt_idx" ON "IssueComment"("issueId", "createdAt");

-- CreateIndex
CREATE INDEX "IssueComment_authorId_idx" ON "IssueComment"("authorId");

-- CreateIndex
CREATE INDEX "IssueComment_parentCommentId_idx" ON "IssueComment"("parentCommentId");

-- CreateIndex
CREATE INDEX "IssueAttachment_issueId_idx" ON "IssueAttachment"("issueId");

-- CreateIndex
CREATE INDEX "IssueAttachment_commentId_idx" ON "IssueAttachment"("commentId");

-- CreateIndex
CREATE INDEX "IssueLink_issueId_idx" ON "IssueLink"("issueId");

-- CreateIndex
CREATE UNIQUE INDEX "MailInboundLog_messageId_key" ON "MailInboundLog"("messageId");

-- CreateIndex
CREATE INDEX "MailInboundLog_tenantId_status_createdAt_idx" ON "MailInboundLog"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MailInboundLog_projectId_createdAt_idx" ON "MailInboundLog"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "IssueRelation_targetIssueId_idx" ON "IssueRelation"("targetIssueId");

-- CreateIndex
CREATE UNIQUE INDEX "IssueRelation_sourceIssueId_targetIssueId_relationType_key" ON "IssueRelation"("sourceIssueId", "targetIssueId", "relationType");

-- CreateIndex
CREATE INDEX "IssueActivity_issueId_epoch_idx" ON "IssueActivity"("issueId", "epoch");

-- CreateIndex
CREATE INDEX "IssueActivity_tenantId_createdAt_idx" ON "IssueActivity"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IssueVersion_issueId_versionNumber_key" ON "IssueVersion"("issueId", "versionNumber");

-- CreateIndex
CREATE INDEX "IssueChecklist_issueId_sequence_idx" ON "IssueChecklist"("issueId", "sequence");

-- CreateIndex
CREATE INDEX "IssueChecklist_tenantId_idx" ON "IssueChecklist"("tenantId");

-- CreateIndex
CREATE INDEX "IssueChecklistItem_checklistId_sequence_idx" ON "IssueChecklistItem"("checklistId", "sequence");

-- CreateIndex
CREATE INDEX "IssueChecklistItem_tenantId_idx" ON "IssueChecklistItem"("tenantId");

-- CreateIndex
CREATE INDEX "IntakeIssue_tenantId_status_idx" ON "IntakeIssue"("tenantId", "status");

-- CreateIndex
CREATE INDEX "IntakeIssue_source_createdAt_idx" ON "IntakeIssue"("source", "createdAt");

-- CreateIndex
CREATE INDEX "IssueWebhook_tenantId_isActive_idx" ON "IssueWebhook"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "IssueWebhookLog_webhookId_createdAt_idx" ON "IssueWebhookLog"("webhookId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TeamTemplate_tenantId_slug_key" ON "TeamTemplate"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "ImportLog_tenantId_startedAt_idx" ON "ImportLog"("tenantId", "startedAt");

-- CreateIndex
CREATE INDEX "ImportLog_tenantId_status_idx" ON "ImportLog"("tenantId", "status");

-- CreateIndex
CREATE INDEX "HolidayCalendar_date_idx" ON "HolidayCalendar"("date");

-- CreateIndex
CREATE UNIQUE INDEX "HolidayCalendar_tenantId_date_key" ON "HolidayCalendar"("tenantId", "date");

-- CreateIndex
CREATE INDEX "ActivityFeedItem_tenantId_feedType_emittedAt_idx" ON "ActivityFeedItem"("tenantId", "feedType", "emittedAt");

-- CreateIndex
CREATE INDEX "ActivityFeedItem_tenantId_targetUserId_status_idx" ON "ActivityFeedItem"("tenantId", "targetUserId", "status");

-- CreateIndex
CREATE INDEX "ActivityFeedItem_tenantId_teamId_emittedAt_idx" ON "ActivityFeedItem"("tenantId", "teamId", "emittedAt");

-- CreateIndex
CREATE INDEX "ActivityFeedItem_tenantId_visibility_emittedAt_idx" ON "ActivityFeedItem"("tenantId", "visibility", "emittedAt");

-- CreateIndex
CREATE INDEX "ActivityFeedItem_tenantId_expiresAt_idx" ON "ActivityFeedItem"("tenantId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityFeedSubscription_userId_feedType_key" ON "ActivityFeedSubscription"("userId", "feedType");

-- CreateIndex
CREATE INDEX "HelpfulnessTrait_tenantId_helperUserId_idx" ON "HelpfulnessTrait"("tenantId", "helperUserId");

-- CreateIndex
CREATE INDEX "HelpfulnessTrait_tenantId_recipientUserId_idx" ON "HelpfulnessTrait"("tenantId", "recipientUserId");

-- CreateIndex
CREATE INDEX "HelpfulnessTrait_tenantId_traitType_status_idx" ON "HelpfulnessTrait"("tenantId", "traitType", "status");

-- CreateIndex
CREATE INDEX "HelpfulnessTrait_tenantId_status_lastObservedAt_idx" ON "HelpfulnessTrait"("tenantId", "status", "lastObservedAt");

-- CreateIndex
CREATE INDEX "SocialContributionProfile_tenantId_idx" ON "SocialContributionProfile"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialContributionProfile_tenantId_userId_key" ON "SocialContributionProfile"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "HelpfulnessSpotlight_tenantId_status_idx" ON "HelpfulnessSpotlight"("tenantId", "status");

-- CreateIndex
CREATE INDEX "HelpfulnessSpotlight_helperUserId_periodFrom_idx" ON "HelpfulnessSpotlight"("helperUserId", "periodFrom");

-- CreateIndex
CREATE INDEX "Recognition_toUserId_createdAt_idx" ON "Recognition"("toUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Recognition_tenantId_type_idx" ON "Recognition"("tenantId", "type");

-- CreateIndex
CREATE INDEX "Recognition_tenantId_toUserId_visibility_idx" ON "Recognition"("tenantId", "toUserId", "visibility");

-- CreateIndex
CREATE UNIQUE INDEX "Badge_slug_key" ON "Badge"("slug");

-- CreateIndex
CREATE INDEX "UserBadge_userId_awardedAt_idx" ON "UserBadge"("userId", "awardedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserBadge_userId_badgeId_key" ON "UserBadge"("userId", "badgeId");

-- CreateIndex
CREATE UNIQUE INDEX "ContributionSnapshot_userId_key" ON "ContributionSnapshot"("userId");

-- CreateIndex
CREATE INDEX "PushSubscription_tenantId_userId_idx" ON "PushSubscription"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_userId_endpoint_key" ON "PushSubscription"("userId", "endpoint");

-- CreateIndex
CREATE INDEX "AdminSetting_category_section_idx" ON "AdminSetting"("category", "section");

-- CreateIndex
CREATE INDEX "AdminSettingHistory_key_changedAt_idx" ON "AdminSettingHistory"("key", "changedAt");

-- CreateIndex
CREATE INDEX "SystemMessage_isActive_startsAt_idx" ON "SystemMessage"("isActive", "startsAt");

-- CreateIndex
CREATE INDEX "CronRunHistory_cronName_startedAt_idx" ON "CronRunHistory"("cronName", "startedAt");

-- CreateIndex
CREATE INDEX "llm_preference_samples_tenantId_taskType_createdAt_idx" ON "llm_preference_samples"("tenantId", "taskType", "createdAt");

-- CreateIndex
CREATE INDEX "FeedbackMessage_processedAt_idx" ON "FeedbackMessage"("processedAt");

-- CreateIndex
CREATE INDEX "FeedbackMessage_userId_createdAt_idx" ON "FeedbackMessage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "FeedbackTopic_status_idx" ON "FeedbackTopic"("status");

-- CreateIndex
CREATE INDEX "FeedbackTopic_createdAt_idx" ON "FeedbackTopic"("createdAt");

-- CreateIndex
CREATE INDEX "FeedbackItem_topicId_createdAt_idx" ON "FeedbackItem"("topicId", "createdAt");

-- CreateIndex
CREATE INDEX "FeedbackItem_messageId_idx" ON "FeedbackItem"("messageId");

-- CreateIndex
CREATE INDEX "FeedbackItem_discarded_idx" ON "FeedbackItem"("discarded");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_tenantId_key" ON "Subscription"("tenantId");

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

-- CreateIndex
CREATE INDEX "Subscription_currentPeriodEnd_idx" ON "Subscription"("currentPeriodEnd");

-- CreateIndex
CREATE INDEX "Subscription_renewalMethod_autoRenew_currentPeriodEnd_idx" ON "Subscription"("renewalMethod", "autoRenew", "currentPeriodEnd");

-- CreateIndex
CREATE INDEX "SubscriptionEvent_subscriptionId_createdAt_idx" ON "SubscriptionEvent"("subscriptionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_billingNumber_key" ON "Invoice"("billingNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_status_idx" ON "Invoice"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Invoice_status_paidAt_idx" ON "Invoice"("status", "paidAt");

-- CreateIndex
CREATE INDEX "Invoice_providerInvoiceId_idx" ON "Invoice"("providerInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingEventLog_jti_key" ON "BillingEventLog"("jti");

-- CreateIndex
CREATE INDEX "BillingEventLog_eventType_idx" ON "BillingEventLog"("eventType");

-- CreateIndex
CREATE INDEX "BillingEventLog_externalEventId_idx" ON "BillingEventLog"("externalEventId");

-- CreateIndex
CREATE INDEX "BillingEventLog_tenantId_idx" ON "BillingEventLog"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingEventLog_providerName_externalEventId_key" ON "BillingEventLog"("providerName", "externalEventId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingsBalance_tenantId_key" ON "MeetingsBalance"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_ownerUserId_key" ON "Referral"("ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_slug_key" ON "Referral"("slug");

-- CreateIndex
CREATE INDEX "Referral_slug_idx" ON "Referral"("slug");

-- CreateIndex
CREATE INDEX "ReferralAttribution_slug_createdAt_idx" ON "ReferralAttribution"("slug", "createdAt");

-- CreateIndex
CREATE INDEX "ReferralAttribution_fingerprint_idx" ON "ReferralAttribution"("fingerprint");

-- CreateIndex
CREATE INDEX "ReferralAttribution_expiresAt_idx" ON "ReferralAttribution"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralAttribution_referralId_fingerprint_dateBucket_key" ON "ReferralAttribution"("referralId", "fingerprint", "dateBucket");

-- CreateIndex
CREATE UNIQUE INDEX "ClientReferralLink_tenantId_key" ON "ClientReferralLink"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientReferralLink_subscriptionId_key" ON "ClientReferralLink"("subscriptionId");

-- CreateIndex
CREATE INDEX "ClientReferralLink_referralId_idx" ON "ClientReferralLink"("referralId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralPayout_triggerInvoiceId_key" ON "ReferralPayout"("triggerInvoiceId");

-- CreateIndex
CREATE INDEX "ReferralPayout_referralId_periodMonth_idx" ON "ReferralPayout"("referralId", "periodMonth");

-- CreateIndex
CREATE INDEX "ReferralPayout_status_idx" ON "ReferralPayout"("status");

-- CreateIndex
CREATE INDEX "PromptFeedback_promptKey_createdAt_idx" ON "PromptFeedback"("promptKey", "createdAt");

-- CreateIndex
CREATE INDEX "PromptFeedback_tenantId_idx" ON "PromptFeedback"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PromptFeedback_invocationId_key" ON "PromptFeedback"("invocationId");

-- CreateIndex
CREATE INDEX "PromptRule_promptKey_status_idx" ON "PromptRule"("promptKey", "status");

-- CreateIndex
CREATE INDEX "PromptRule_tenantId_status_idx" ON "PromptRule"("tenantId", "status");

-- CreateIndex
CREATE INDEX "concierge_step_scores_conversationId_stepIndex_idx" ON "concierge_step_scores"("conversationId", "stepIndex");

-- CreateIndex
CREATE INDEX "concierge_step_scores_tenantId_createdAt_idx" ON "concierge_step_scores"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "concierge_step_scores_promotedToActive_prmAgreed_idx" ON "concierge_step_scores"("promotedToActive", "prmAgreed");

-- CreateIndex
CREATE INDEX "PromptCandidate_promptKey_status_idx" ON "PromptCandidate"("promptKey", "status");

-- CreateIndex
CREATE INDEX "PromptCandidate_tenantId_promptKey_status_idx" ON "PromptCandidate"("tenantId", "promptKey", "status");

-- CreateIndex
CREATE INDEX "PromptCandidate_status_abStartedAt_idx" ON "PromptCandidate"("status", "abStartedAt");

-- CreateIndex
CREATE INDEX "Table_tenantId_archivedAt_idx" ON "Table"("tenantId", "archivedAt");

-- CreateIndex
CREATE INDEX "Table_parentDocumentId_idx" ON "Table"("parentDocumentId");

-- CreateIndex
CREATE INDEX "Table_tenantId_isSystem_idx" ON "Table"("tenantId", "isSystem");

-- CreateIndex
CREATE UNIQUE INDEX "Table_tenantId_systemKey_key" ON "Table"("tenantId", "systemKey");

-- CreateIndex
CREATE INDEX "TableProperty_tableId_order_idx" ON "TableProperty"("tableId", "order");

-- CreateIndex
CREATE INDEX "TableRow_tableId_order_idx" ON "TableRow"("tableId", "order");

-- CreateIndex
CREATE INDEX "TableRow_tableId_archivedAt_idx" ON "TableRow"("tableId", "archivedAt");

-- CreateIndex
CREATE INDEX "TableRow_entityId_idx" ON "TableRow"("entityId");

-- CreateIndex
CREATE INDEX "TableView_tableId_idx" ON "TableView"("tableId");

-- CreateIndex
CREATE INDEX "TableCellProvenance_tableRowId_propertyId_idx" ON "TableCellProvenance"("tableRowId", "propertyId");

-- CreateIndex
CREATE INDEX "TableCellProvenance_tenantId_sourceType_sourceId_idx" ON "TableCellProvenance"("tenantId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "TableCellPendingPatch_tenantId_status_idx" ON "TableCellPendingPatch"("tenantId", "status");

-- CreateIndex
CREATE INDEX "TableCellPendingPatch_tableId_status_idx" ON "TableCellPendingPatch"("tableId", "status");

-- CreateIndex
CREATE INDEX "TableCellPendingPatch_tableRowId_propertyId_idx" ON "TableCellPendingPatch"("tableRowId", "propertyId");

-- CreateIndex
CREATE INDEX "SystemLog_createdAt_idx" ON "SystemLog"("createdAt");

-- CreateIndex
CREATE INDEX "SystemLog_level_createdAt_idx" ON "SystemLog"("level", "createdAt");

-- CreateIndex
CREATE INDEX "SystemLog_category_createdAt_idx" ON "SystemLog"("category", "createdAt");

-- CreateIndex
CREATE INDEX "SystemLog_contour_createdAt_idx" ON "SystemLog"("contour", "createdAt");

-- CreateIndex
CREATE INDEX "SystemLog_pipeline_createdAt_idx" ON "SystemLog"("pipeline", "createdAt");

-- CreateIndex
CREATE INDEX "SystemLog_module_createdAt_idx" ON "SystemLog"("module", "createdAt");

-- CreateIndex
CREATE INDEX "SystemLog_statusCode_createdAt_idx" ON "SystemLog"("statusCode", "createdAt");

-- CreateIndex
CREATE INDEX "SystemLog_userId_createdAt_idx" ON "SystemLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SystemLog_orgId_createdAt_idx" ON "SystemLog"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "SystemLog_requestId_idx" ON "SystemLog"("requestId");

-- CreateIndex
CREATE INDEX "SystemLog_traceId_createdAt_idx" ON "SystemLog"("traceId", "createdAt");

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserVerificationToken" ADD CONSTRAINT "UserVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_linkedIssueId_fkey" FOREIGN KEY ("linkedIssueId") REFERENCES "Issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_linkedCycleId_fkey" FOREIGN KEY ("linkedCycleId") REFERENCES "Cycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recording" ADD CONSTRAINT "Recording_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioTrack" ADD CONSTRAINT "AudioTrack_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioTrack" ADD CONSTRAINT "AudioTrack_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptTrack" ADD CONSTRAINT "TranscriptTrack_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "Transcript"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiResult" ADD CONSTRAINT "AiResult_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiResult" ADD CONSTRAINT "AiResult_promptTemplateVersionId_fkey" FOREIGN KEY ("promptTemplateVersionId") REFERENCES "PromptTemplateVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsageLog" ADD CONSTRAINT "AiUsageLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingEvent" ADD CONSTRAINT "MeetingEvent_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordingAction" ADD CONSTRAINT "RecordingAction_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingChapter" ADD CONSTRAINT "MeetingChapter_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingChapter" ADD CONSTRAINT "MeetingChapter_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingHighlight" ADD CONSTRAINT "MeetingHighlight_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingHighlight" ADD CONSTRAINT "MeetingHighlight_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingHighlight" ADD CONSTRAINT "MeetingHighlight_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingShare" ADD CONSTRAINT "MeetingShare_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingShare" ADD CONSTRAINT "MeetingShare_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingShareView" ADD CONSTRAINT "MeetingShareView_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "MeetingShare"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HighlightShare" ADD CONSTRAINT "HighlightShare_highlightId_fkey" FOREIGN KEY ("highlightId") REFERENCES "MeetingHighlight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HighlightShare" ADD CONSTRAINT "HighlightShare_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingTag" ADD CONSTRAINT "MeetingTag_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingTag" ADD CONSTRAINT "MeetingTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingChatMessage" ADD CONSTRAINT "MeetingChatMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingChatMessage" ADD CONSTRAINT "MeetingChatMessage_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingChatMessage" ADD CONSTRAINT "MeetingChatMessage_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingChatMessage" ADD CONSTRAINT "MeetingChatMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingRoomMessage" ADD CONSTRAINT "MeetingRoomMessage_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingRoomMessage" ADD CONSTRAINT "MeetingRoomMessage_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingTranscriptChunk" ADD CONSTRAINT "MeetingTranscriptChunk_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookSubscription" ADD CONSTRAINT "WebhookSubscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookSubscription" ADD CONSTRAINT "WebhookSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "WebhookSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationDestination" ADD CONSTRAINT "IntegrationDestination_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationDestination" ADD CONSTRAINT "IntegrationDestination_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Export" ADD CONSTRAINT "Export_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Export" ADD CONSTRAINT "Export_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTemplate" ADD CONSTRAINT "UserTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmTaskRoute" ADD CONSTRAINT "LlmTaskRoute_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmTaskRouteChange" ADD CONSTRAINT "LlmTaskRouteChange_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentLog" ADD CONSTRAINT "ConsentLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentLog" ADD CONSTRAINT "ConsentLog_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeAccessLog" ADD CONSTRAINT "KnowledgeAccessLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiAccessLog" ADD CONSTRAINT "ApiAccessLog_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiAccessLog" ADD CONSTRAINT "ApiAccessLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserQuotaCounter" ADD CONSTRAINT "UserQuotaCounter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_bornFromThemeId_fkey" FOREIGN KEY ("bornFromThemeId") REFERENCES "Theme"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "CardVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Org" ADD CONSTRAINT "Org_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_invitedBy_fkey" FOREIGN KEY ("invitedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloneAccessGrant" ADD CONSTRAINT "CloneAccessGrant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloneAccessGrant" ADD CONSTRAINT "CloneAccessGrant_grantedToUserId_fkey" FOREIGN KEY ("grantedToUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloneAccessGrant" ADD CONSTRAINT "CloneAccessGrant_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloneAccessGrant" ADD CONSTRAINT "CloneAccessGrant_revokedBy_fkey" FOREIGN KEY ("revokedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgInvitation" ADD CONSTRAINT "OrgInvitation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgInvitation" ADD CONSTRAINT "OrgInvitation_invitedBy_fkey" FOREIGN KEY ("invitedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgInvitation" ADD CONSTRAINT "OrgInvitation_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgInvitation" ADD CONSTRAINT "OrgInvitation_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeCapabilityOverride" ADD CONSTRAINT "EmployeeCapabilityOverride_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeCapabilityOverride" ADD CONSTRAINT "EmployeeCapabilityOverride_grantedToUserId_fkey" FOREIGN KEY ("grantedToUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeCapabilityOverride" ADD CONSTRAINT "EmployeeCapabilityOverride_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmModelPrice" ADD CONSTRAINT "LlmModelPrice_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "llm_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmModelPrice" ADD CONSTRAINT "LlmModelPrice_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_models" ADD CONSTRAINT "llm_models_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "llm_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_cost_daily" ADD CONSTRAINT "ai_cost_daily_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_budget_caps" ADD CONSTRAINT "org_budget_caps_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_budget_caps" ADD CONSTRAINT "org_budget_caps_setByUserId_fkey" FOREIGN KEY ("setByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawEvent" ADD CONSTRAINT "RawEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawEvent" ADD CONSTRAINT "RawEvent_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdeaBlock" ADD CONSTRAINT "IdeaBlock_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdeaBlock" ADD CONSTRAINT "IdeaBlock_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "IdeaBlock"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdeaBlock" ADD CONSTRAINT "IdeaBlock_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "IdeaBlock"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdeaBlock" ADD CONSTRAINT "IdeaBlock_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdeaBlock" ADD CONSTRAINT "IdeaBlock_commitmentRecipientPersonId_fkey" FOREIGN KEY ("commitmentRecipientPersonId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdeaBlockAxisLabel" ADD CONSTRAINT "IdeaBlockAxisLabel_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "IdeaBlock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdeaBlockAxisLabel" ADD CONSTRAINT "IdeaBlockAxisLabel_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdeaBlockEvidence" ADD CONSTRAINT "IdeaBlockEvidence_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "IdeaBlock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdeaBlockEvidence" ADD CONSTRAINT "IdeaBlockEvidence_rawEventId_fkey" FOREIGN KEY ("rawEventId") REFERENCES "RawEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entity" ADD CONSTRAINT "Entity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entity" ADD CONSTRAINT "Entity_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventParticipant" ADD CONSTRAINT "EventParticipant_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventParticipant" ADD CONSTRAINT "EventParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventParticipant" ADD CONSTRAINT "EventParticipant_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventReminder" ADD CONSTRAINT "EventReminder_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Market" ADD CONSTRAINT "Market_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Market" ADD CONSTRAINT "Market_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgUnit" ADD CONSTRAINT "OrgUnit_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgUnit" ADD CONSTRAINT "OrgUnit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurationItem" ADD CONSTRAINT "CurationItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurationItem" ADD CONSTRAINT "CurationItem_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurationDecision" ADD CONSTRAINT "CurationDecision_curationItemId_fkey" FOREIGN KEY ("curationItemId") REFERENCES "CurationItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurationDecision" ADD CONSTRAINT "CurationDecision_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingActionSnooze" ADD CONSTRAINT "PendingActionSnooze_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflictItem" ADD CONSTRAINT "ConflictItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflictItem" ADD CONSTRAINT "ConflictItem_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardVersion" ADD CONSTRAINT "CardVersion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardVersion" ADD CONSTRAINT "CardVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardVersion" ADD CONSTRAINT "CardVersion_previousVersionId_fkey" FOREIGN KEY ("previousVersionId") REFERENCES "CardVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardVersion" ADD CONSTRAINT "CardVersion_curationItemId_fkey" FOREIGN KEY ("curationItemId") REFERENCES "CurationItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CuratorAssignment" ADD CONSTRAINT "CuratorAssignment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "completeness_slots" ADD CONSTRAINT "completeness_slots_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdeaBlockEntity" ADD CONSTRAINT "IdeaBlockEntity_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "IdeaBlock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdeaBlockEntity" ADD CONSTRAINT "IdeaBlockEntity_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdeaBlockLink" ADD CONSTRAINT "IdeaBlockLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdeaBlockLink" ADD CONSTRAINT "IdeaBlockLink_fromBlockId_fkey" FOREIGN KEY ("fromBlockId") REFERENCES "IdeaBlock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdeaBlockLink" ADD CONSTRAINT "IdeaBlockLink_toBlockId_fkey" FOREIGN KEY ("toBlockId") REFERENCES "IdeaBlock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityLink" ADD CONSTRAINT "EntityLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Theme" ADD CONSTRAINT "Theme_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Theme" ADD CONSTRAINT "Theme_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Theme"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThemeIdeaBlock" ADD CONSTRAINT "ThemeIdeaBlock_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "Theme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThemeIdeaBlock" ADD CONSTRAINT "ThemeIdeaBlock_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "IdeaBlock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThemeEntity" ADD CONSTRAINT "ThemeEntity_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "Theme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThemeEntity" ADD CONSTRAINT "ThemeEntity_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuperAdminAccessLog" ADD CONSTRAINT "SuperAdminAccessLog_superAdminUserId_fkey" FOREIGN KEY ("superAdminUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_parentGoalId_fkey" FOREIGN KEY ("parentGoalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalTheme" ADD CONSTRAINT "GoalTheme_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalTheme" ADD CONSTRAINT "GoalTheme_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "Theme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalAlignmentSnapshot" ADD CONSTRAINT "GoalAlignmentSnapshot_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalAlignmentSnapshot" ADD CONSTRAINT "GoalAlignmentSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalKeyResult" ADD CONSTRAINT "GoalKeyResult_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalKeyResultCheckpoint" ADD CONSTRAINT "GoalKeyResultCheckpoint_keyResultId_fkey" FOREIGN KEY ("keyResultId") REFERENCES "GoalKeyResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_goals_pulse_digests" ADD CONSTRAINT "weekly_goals_pulse_digests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgRetentionPolicy" ADD CONSTRAINT "OrgRetentionPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgEntitlement" ADD CONSTRAINT "OrgEntitlement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_parentDepartmentId_fkey" FOREIGN KEY ("parentDepartmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_headPersonId_fkey" FOREIGN KEY ("headPersonId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persons" ADD CONSTRAINT "persons_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persons" ADD CONSTRAINT "persons_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persons" ADD CONSTRAINT "persons_primaryDepartmentId_fkey" FOREIGN KEY ("primaryDepartmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persons" ADD CONSTRAINT "persons_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_knowledge_category_embeddings" ADD CONSTRAINT "person_knowledge_category_embeddings_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_roles" ADD CONSTRAINT "person_roles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_roles" ADD CONSTRAINT "person_roles_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_roles" ADD CONSTRAINT "person_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_descriptions" ADD CONSTRAINT "job_descriptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_descriptions" ADD CONSTRAINT "job_descriptions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_descriptions" ADD CONSTRAINT "job_descriptions_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skills" ADD CONSTRAINT "skills_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_attachedRoleId_fkey" FOREIGN KEY ("attachedRoleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_voice_profiles" ADD CONSTRAINT "brand_voice_profiles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_profiles" ADD CONSTRAINT "role_profiles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_profiles" ADD CONSTRAINT "role_profiles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "responsibility_elements" ADD CONSTRAINT "responsibility_elements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "responsibility_elements" ADD CONSTRAINT "responsibility_elements_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "responsibility_elements" ADD CONSTRAINT "responsibility_elements_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "responsibility_elements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authority_boundaries" ADD CONSTRAINT "authority_boundaries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authority_boundaries" ADD CONSTRAINT "authority_boundaries_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authority_boundaries" ADD CONSTRAINT "authority_boundaries_approverRoleId_fkey" FOREIGN KEY ("approverRoleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "required_knowledge" ADD CONSTRAINT "required_knowledge_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "required_knowledge" ADD CONSTRAINT "required_knowledge_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_policies" ADD CONSTRAINT "decision_policies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_policies" ADD CONSTRAINT "decision_policies_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_policies" ADD CONSTRAINT "decision_policies_regulationId_fkey" FOREIGN KEY ("regulationId") REFERENCES "regulations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_counterpartRoleId_fkey" FOREIGN KEY ("counterpartRoleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_counterpartDepartmentId_fkey" FOREIGN KEY ("counterpartDepartmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "missions" ADD CONSTRAINT "missions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visions" ADD CONSTRAINT "visions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_profiles" ADD CONSTRAINT "company_profiles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "functional_domains" ADD CONSTRAINT "functional_domains_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "functional_domains" ADD CONSTRAINT "functional_domains_parentDomainId_fkey" FOREIGN KEY ("parentDomainId") REFERENCES "functional_domains"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_domain_links" ADD CONSTRAINT "department_domain_links_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_domain_links" ADD CONSTRAINT "department_domain_links_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_domain_links" ADD CONSTRAINT "department_domain_links_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "functional_domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processes" ADD CONSTRAINT "processes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processes" ADD CONSTRAINT "processes_ownerRoleId_fkey" FOREIGN KEY ("ownerRoleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processes" ADD CONSTRAINT "processes_ownerPersonId_fkey" FOREIGN KEY ("ownerPersonId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processes" ADD CONSTRAINT "processes_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "CardVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processes" ADD CONSTRAINT "processes_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "process_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_templates" ADD CONSTRAINT "process_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_templates" ADD CONSTRAINT "process_templates_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "process_template_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_templates" ADD CONSTRAINT "process_templates_ownerRoleId_fkey" FOREIGN KEY ("ownerRoleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_templates" ADD CONSTRAINT "process_templates_ownerPersonId_fkey" FOREIGN KEY ("ownerPersonId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cross_functional_friction_reports" ADD CONSTRAINT "cross_functional_friction_reports_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cross_functional_friction_reports" ADD CONSTRAINT "cross_functional_friction_reports_processTemplateId_fkey" FOREIGN KEY ("processTemplateId") REFERENCES "process_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_template_versions" ADD CONSTRAINT "process_template_versions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_template_versions" ADD CONSTRAINT "process_template_versions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "process_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_template_versions" ADD CONSTRAINT "process_template_versions_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_points" ADD CONSTRAINT "decision_points_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_points" ADD CONSTRAINT "decision_points_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "process_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_points" ADD CONSTRAINT "decision_points_processStepId_fkey" FOREIGN KEY ("processStepId") REFERENCES "process_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_points" ADD CONSTRAINT "decision_points_decidedByRoleId_fkey" FOREIGN KEY ("decidedByRoleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_handoffs" ADD CONSTRAINT "process_handoffs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_handoffs" ADD CONSTRAINT "process_handoffs_fromTemplateId_fkey" FOREIGN KEY ("fromTemplateId") REFERENCES "process_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_handoffs" ADD CONSTRAINT "process_handoffs_toTemplateId_fkey" FOREIGN KEY ("toTemplateId") REFERENCES "process_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_handoffs" ADD CONSTRAINT "process_handoffs_fromProcessStepId_fkey" FOREIGN KEY ("fromProcessStepId") REFERENCES "process_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_handoffs" ADD CONSTRAINT "process_handoffs_toProcessStepId_fkey" FOREIGN KEY ("toProcessStepId") REFERENCES "process_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_handoffs" ADD CONSTRAINT "process_handoffs_fromRoleId_fkey" FOREIGN KEY ("fromRoleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_handoffs" ADD CONSTRAINT "process_handoffs_toRoleId_fkey" FOREIGN KEY ("toRoleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_steps" ADD CONSTRAINT "process_steps_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_steps" ADD CONSTRAINT "process_steps_processId_fkey" FOREIGN KEY ("processId") REFERENCES "processes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulations" ADD CONSTRAINT "regulations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulations" ADD CONSTRAINT "regulations_ownerPersonId_fkey" FOREIGN KEY ("ownerPersonId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulations" ADD CONSTRAINT "regulations_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "regulations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulations" ADD CONSTRAINT "regulations_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "CardVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_ownerPersonId_fkey" FOREIGN KEY ("ownerPersonId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "CardVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tools" ADD CONSTRAINT "tools_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_attachedToResponsibilityElementId_fkey" FOREIGN KEY ("attachedToResponsibilityElementId") REFERENCES "responsibility_elements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_attachedToRoleId_fkey" FOREIGN KEY ("attachedToRoleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_attachedToDepartmentId_fkey" FOREIGN KEY ("attachedToDepartmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_decidedByPersonId_fkey" FOREIGN KEY ("decidedByPersonId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_sourceMeetingId_fkey" FOREIGN KEY ("sourceMeetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_sourceIdeaBlockId_fkey" FOREIGN KEY ("sourceIdeaBlockId") REFERENCES "IdeaBlock"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "CardVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_appliedPolicyId_fkey" FOREIGN KEY ("appliedPolicyId") REFERENCES "decision_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insights" ADD CONSTRAINT "insights_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insights" ADD CONSTRAINT "insights_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "CardVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "idea_clusters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "CardVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_clusters" ADD CONSTRAINT "idea_clusters_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "probe_events" ADD CONSTRAINT "probe_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptTemplate" ADD CONSTRAINT "PromptTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptTemplate" ADD CONSTRAINT "PromptTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptTemplate" ADD CONSTRAINT "PromptTemplate_activeVersionId_fkey" FOREIGN KEY ("activeVersionId") REFERENCES "PromptTemplateVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptTemplateVersion" ADD CONSTRAINT "PromptTemplateVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptTemplateVersion" ADD CONSTRAINT "PromptTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PromptTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptTemplateSection" ADD CONSTRAINT "PromptTemplateSection_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "PromptTemplateVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptExperiment" ADD CONSTRAINT "PromptExperiment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptExperiment" ADD CONSTRAINT "PromptExperiment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptExperiment" ADD CONSTRAINT "PromptExperiment_templateAId_fkey" FOREIGN KEY ("templateAId") REFERENCES "PromptTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptExperiment" ADD CONSTRAINT "PromptExperiment_templateBId_fkey" FOREIGN KEY ("templateBId") REFERENCES "PromptTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiResultFeedback" ADD CONSTRAINT "AiResultFeedback_aiResultId_fkey" FOREIGN KEY ("aiResultId") REFERENCES "AiResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiResultFeedback" ADD CONSTRAINT "AiResultFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingReport" ADD CONSTRAINT "MeetingReport_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingReport" ADD CONSTRAINT "MeetingReport_promptTemplateId_fkey" FOREIGN KEY ("promptTemplateId") REFERENCES "PromptTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingReport" ADD CONSTRAINT "MeetingReport_promptTemplateVersionId_fkey" FOREIGN KEY ("promptTemplateVersionId") REFERENCES "PromptTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_bindings" ADD CONSTRAINT "channel_bindings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_bindings" ADD CONSTRAINT "channel_bindings_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_channelBindingId_fkey" FOREIGN KEY ("channelBindingId") REFERENCES "channel_bindings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_check_ins" ADD CONSTRAINT "daily_check_ins_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_check_ins" ADD CONSTRAINT "daily_check_ins_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_engagement_snapshots" ADD CONSTRAINT "person_engagement_snapshots_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_engagement_snapshots" ADD CONSTRAINT "person_engagement_snapshots_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_snapshots" ADD CONSTRAINT "forecast_snapshots_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_risk_snapshots" ADD CONSTRAINT "knowledge_risk_snapshots_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_topics" ADD CONSTRAINT "recurring_topics_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promise_network_snapshots" ADD CONSTRAINT "promise_network_snapshots_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_goal_contributions" ADD CONSTRAINT "person_goal_contributions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_velocity_snapshots" ADD CONSTRAINT "knowledge_velocity_snapshots_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_operations_digests" ADD CONSTRAINT "weekly_operations_digests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_operations_digests" ADD CONSTRAINT "daily_operations_digests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proactive_notifications" ADD CONSTRAINT "proactive_notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proactive_notifications" ADD CONSTRAINT "proactive_notifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingBehaviorMetrics" ADD CONSTRAINT "MeetingBehaviorMetrics_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingParticipantBehavior" ADD CONSTRAINT "MeetingParticipantBehavior_meetingBehaviorMetricsId_fkey" FOREIGN KEY ("meetingBehaviorMetricsId") REFERENCES "MeetingBehaviorMetrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingParticipantBehavior" ADD CONSTRAINT "MeetingParticipantBehavior_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingQualityScore" ADD CONSTRAINT "MeetingQualityScore_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatV2Conversation" ADD CONSTRAINT "ChatV2Conversation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatV2Conversation" ADD CONSTRAINT "ChatV2Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatV2Message" ADD CONSTRAINT "ChatV2Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ChatV2Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_profiles" ADD CONSTRAINT "skill_profiles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_profiles" ADD CONSTRAINT "skill_profiles_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_traits" ADD CONSTRAINT "skill_traits_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "skill_trait_concepts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_traits" ADD CONSTRAINT "skill_traits_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "skill_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_traits" ADD CONSTRAINT "skill_traits_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "skill_trait_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_trait_concepts" ADD CONSTRAINT "skill_trait_concepts_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "skill_trait_concepts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_trait_concepts" ADD CONSTRAINT "skill_trait_concepts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_skills" ADD CONSTRAINT "practice_skills_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_usages" ADD CONSTRAINT "skill_usages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_usages" ADD CONSTRAINT "skill_usages_practiceSkillId_fkey" FOREIGN KEY ("practiceSkillId") REFERENCES "practice_skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_trait_categories" ADD CONSTRAINT "skill_trait_categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_trait_categories" ADD CONSTRAINT "skill_trait_categories_parentCategoryId_fkey" FOREIGN KEY ("parentCategoryId") REFERENCES "skill_trait_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "executable_personas" ADD CONSTRAINT "executable_personas_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "executable_personas" ADD CONSTRAINT "executable_personas_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "skill_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "executable_personas" ADD CONSTRAINT "executable_personas_succeedsPersonaId_fkey" FOREIGN KEY ("succeedsPersonaId") REFERENCES "executable_personas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_versions" ADD CONSTRAINT "experiment_versions_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "experiments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_versions" ADD CONSTRAINT "experiment_versions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concierge_conversations" ADD CONSTRAINT "concierge_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concierge_conversations" ADD CONSTRAINT "concierge_conversations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concierge_messages" ADD CONSTRAINT "concierge_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "concierge_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concierge_undo_logs" ADD CONSTRAINT "concierge_undo_logs_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "concierge_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concierge_undo_logs" ADD CONSTRAINT "concierge_undo_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_concierge_quotas" ADD CONSTRAINT "org_concierge_quotas_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orchestrator_runs" ADD CONSTRAINT "orchestrator_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orchestrator_runs" ADD CONSTRAINT "orchestrator_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orchestrator_subagent_jobs" ADD CONSTRAINT "orchestrator_subagent_jobs_runId_fkey" FOREIGN KEY ("runId") REFERENCES "orchestrator_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_teamTemplateId_fkey" FOREIGN KEY ("teamTemplateId") REFERENCES "TeamTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_customerCardId_fkey" FOREIGN KEY ("customerCardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_subjectPersonId_fkey" FOREIGN KEY ("subjectPersonId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDocument" ADD CONSTRAINT "ProjectDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDocument" ADD CONSTRAINT "ProjectDocument_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ProjectDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Board" ADD CONSTRAINT "Board_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueState" ADD CONSTRAINT "IssueState_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cycle" ADD CONSTRAINT "Cycle_primaryGoalId_fkey" FOREIGN KEY ("primaryGoalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cycle" ADD CONSTRAINT "Cycle_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SprintHint" ADD CONSTRAINT "SprintHint_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "Cycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "IssueState"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "Cycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueAssignee" ADD CONSTRAINT "IssueAssignee_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Label" ADD CONSTRAINT "Label_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueLabel" ADD CONSTRAINT "IssueLabel_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueLabel" ADD CONSTRAINT "IssueLabel_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "Label"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueSubscriber" ADD CONSTRAINT "IssueSubscriber_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueMention" ADD CONSTRAINT "IssueMention_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueMention" ADD CONSTRAINT "IssueMention_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "IssueComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueComment" ADD CONSTRAINT "IssueComment_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueComment" ADD CONSTRAINT "IssueComment_parentCommentId_fkey" FOREIGN KEY ("parentCommentId") REFERENCES "IssueComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueAttachment" ADD CONSTRAINT "IssueAttachment_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueAttachment" ADD CONSTRAINT "IssueAttachment_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "IssueComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueLink" ADD CONSTRAINT "IssueLink_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailInboundLog" ADD CONSTRAINT "MailInboundLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailInboundLog" ADD CONSTRAINT "MailInboundLog_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueRelation" ADD CONSTRAINT "IssueRelation_sourceIssueId_fkey" FOREIGN KEY ("sourceIssueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueRelation" ADD CONSTRAINT "IssueRelation_targetIssueId_fkey" FOREIGN KEY ("targetIssueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueActivity" ADD CONSTRAINT "IssueActivity_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueVersion" ADD CONSTRAINT "IssueVersion_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueChecklist" ADD CONSTRAINT "IssueChecklist_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueChecklistItem" ADD CONSTRAINT "IssueChecklistItem_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "IssueChecklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueWebhookLog" ADD CONSTRAINT "IssueWebhookLog_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "IssueWebhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "Badge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_preference_samples" ADD CONSTRAINT "llm_preference_samples_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackMessage" ADD CONSTRAINT "FeedbackMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackMessage" ADD CONSTRAINT "FeedbackMessage_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackTopic" ADD CONSTRAINT "FeedbackTopic_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "FeedbackTopic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackItem" ADD CONSTRAINT "FeedbackItem_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "FeedbackMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackItem" ADD CONSTRAINT "FeedbackItem_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "FeedbackTopic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionEvent" ADD CONSTRAINT "SubscriptionEvent_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingEventLog" ADD CONSTRAINT "BillingEventLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingEventLog" ADD CONSTRAINT "BillingEventLog_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingsBalance" ADD CONSTRAINT "MeetingsBalance_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralAttribution" ADD CONSTRAINT "ReferralAttribution_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientReferralLink" ADD CONSTRAINT "ClientReferralLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientReferralLink" ADD CONSTRAINT "ClientReferralLink_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientReferralLink" ADD CONSTRAINT "ClientReferralLink_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralPayout" ADD CONSTRAINT "ReferralPayout_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralPayout" ADD CONSTRAINT "ReferralPayout_clientReferralLinkId_fkey" FOREIGN KEY ("clientReferralLinkId") REFERENCES "ClientReferralLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralPayout" ADD CONSTRAINT "ReferralPayout_triggerInvoiceId_fkey" FOREIGN KEY ("triggerInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptFeedback" ADD CONSTRAINT "PromptFeedback_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptRule" ADD CONSTRAINT "PromptRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concierge_step_scores" ADD CONSTRAINT "concierge_step_scores_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptCandidate" ADD CONSTRAINT "PromptCandidate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Table" ADD CONSTRAINT "Table_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableProperty" ADD CONSTRAINT "TableProperty_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableRow" ADD CONSTRAINT "TableRow_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableView" ADD CONSTRAINT "TableView_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableAutomation" ADD CONSTRAINT "TableAutomation_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

