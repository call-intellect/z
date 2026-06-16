import { z } from 'zod';

const ProbeQuestionPayloadSchema = z
  .object({
    question: z.string().min(1).max(4_000),
    context: z.string().max(8_000).optional(),
    options: z.array(z.string().min(1).max(200)).max(20).optional(),
    askedBy: z.string().max(100).optional(),
  })
  .strict();

const ProbeDigestPayloadSchema = z
  .object({
    items: z
      .array(
        z.object({
          question: z.string().min(1).max(400),
          objectTitle: z.string().max(200).optional(),
          probeEventId: z.string(),
        }),
      )
      .min(1)
      .max(20),
    total: z.number().int().nonnegative(),
    summary: z.string().max(4_000).optional(),
  })
  .strict();

const ProbeAnswerAckPayloadSchema = z
  .object({
    text: z.string().min(1).max(400),
    objectTitle: z.string().max(200).optional(),
    probeEventId: z.string().optional(),
    summary: z.string().max(400).optional(),
  })
  .strict();

const CurationPendingPayloadSchema = z
  .object({
    resourceType: z.string().min(1),
    resourceId: z.string().min(1),
    summary: z.string().min(1).max(2_000),
    confidence: z.number().min(0).max(1).optional(),
    actionUrl: z.string().max(2_000).optional(),
  })
  .strict();

const SystemMessagePayloadSchema = z
  .object({
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(8_000),
    severity: z.enum(['info', 'warning', 'error']).default('info'),
    actionUrl: z.string().max(2_000).optional(),
  })
  .strict();

const SpecialistProbePayloadSchema = z
  .object({
    specialistName: z.string().min(1).max(80),
    reason: z.string().min(1).max(80),
    message: z.string().min(1).max(2_000),
    suggestedActions: z.array(z.string().min(1).max(200)).max(5).optional(),
    cardId: z.string().max(80).optional(),
    blockIds: z.array(z.string().min(1).max(80)).max(20).optional(),
    actionUrl: z.string().max(2_000).optional(),
  })
  .strict();

const ChatAnswerPayloadSchema = z
  .object({
    conversationId: z.string(),
    messageId: z.string(),
    text: z.string().min(1).max(16_000),
    citationsCount: z.number().int().min(0).default(0),
    mode: z.enum(['factual', 'synthetic', 'clone_style']).optional(),
    uncertaintyNote: z.string().max(2_000).optional(),
  })
  .strict();

const LiberalPayloadSchema = z.record(z.string(), z.unknown());

const IdeaStatusChangedPayloadSchema = z
  .object({
    ideaId: z.string().min(1),
    statement: z.string().min(1).max(4_000),
    oldStatus: z.string().min(1).max(40),
    newStatus: z.string().min(1).max(40),
    reason: z.string().max(4_000).nullable().optional(),
    title: z.string().max(200).optional(),
    body: z.string().max(2_000).optional(),
    actionUrl: z.string().max(2_000).optional(),
  })
  .strict();

const CheckinPromptPayloadSchema = z
  .object({
    kind: z.literal('checkin'),
    checkInKind: z.enum(['morning', 'evening']),
    personId: z.string().min(1).max(80),
    dateLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    question: z.string().min(1).max(2_000),
    actionUrl: z.string().max(2_000).optional(),
  })
  .strict();

const ProactiveNotificationPayloadSchema = z
  .object({
    proactiveNotificationId: z.string().min(1).max(80),
    ruleType: z.string().min(1).max(60),
    severity: z.enum(['low', 'medium', 'high']),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(4_000),
    actionUrl: z.string().max(2_000).optional(),
  })
  .strict();

const IssueMentionPayloadSchema = z
  .object({
    issueId: z.string().min(1).max(80),
    commentId: z.string().min(1).max(80),
    byUserId: z.string().min(1).max(80),
    snippet: z.string().min(1).max(500),
    issueIdentifier: z.string().max(40).optional(),
    issueTitle: z.string().max(500).optional(),
  })
  .strict();

const OperationsWeeklyDigestPayloadSchema = z
  .object({
    digestId: z.string().min(1).max(80),
    weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    weekEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(4_000),
    actionUrl: z.string().max(2_000).optional(),
  })
  .strict();

const GoalsPulsePayloadSchema = z
  .object({
    digestId: z.string().min(1).max(80),
    isoWeek: z.string().regex(/^\d{4}-W\d{2}$/),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(4_000),
    actionUrl: z.string().max(2_000).optional(),
  })
  .strict();

const OperationsMonthlyRecapPayloadSchema = z
  .object({
    snapshotId: z.string().min(1).max(80),
    periodYm: z.string().regex(/^\d{4}-\d{2}$/),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(4_000),
    actionUrl: z.string().max(2_000).optional(),
  })
  .strict();

const CloneAccessGrantedPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    body: z
      .object({
        cloneType: z.enum(['person', 'role']),
        cloneRefId: z.string().min(1).max(80),
        cloneLabel: z.string().min(1).max(200),
        grantedByUserId: z.string().min(1).max(80),
        grantedByName: z.string().min(1).max(200),
        grantedAt: z.string().datetime(),
        expiresAt: z.string().datetime().nullable(),
      })
      .strict(),
  })
  .strict();

const CheckinAckPayloadSchema = z
  .object({
    kind: z.enum(['morning', 'evening']),
    wasReplace: z.boolean(),
    plansCount: z.number().int().min(0),
    donesCount: z.number().int().min(0),
    blockersCount: z.number().int().min(0),
    lowParserConfidence: z.boolean(),
  })
  .strict();

const NoteAckPayloadSchema = z
  .object({
    text: z.string().min(1).max(500),
  })
  .strict();

const EventReminderPayloadSchema = z
  .object({
    eventId: z.string().min(1).max(80),
    eventTitle: z.string().min(1).max(300),
    startAtIso: z.string().min(1).max(40),
    offsetMin: z
      .number()
      .int()
      .min(0)
      .max(60 * 24 * 7),
    location: z.string().max(300).nullable().optional(),
    actionUrl: z.string().max(2_000).optional(),
  })
  .strict();

const ActionsReminderPayloadSchema = z
  .object({
    total: z.number().int().min(0),
    bySource: z
      .object({
        curation: z.number().int().min(0),
        conflict: z.number().int().min(0),
        intake: z.number().int().min(0),
        probe: z.number().int().min(0),
      })
      .strict(),
    urgentCount: z.number().int().min(0),
    actionUrl: z.string().max(2_000),
    lines: z.array(z.string().min(1).max(500)).max(20),
  })
  .strict();

const MeetingInvitePayloadSchema = z
  .object({
    joinUrl: z.string().min(1).max(2_000),
    meetingTitle: z.string().min(1).max(500),
    hostName: z.string().min(1).max(200),
  })
  .strict();

const SupportTicketEventPayloadSchema = z
  .object({
    ticketId: z.string().min(1).max(80),
    ticketNumber: z.string().min(1).max(40),
    subject: z.string().min(1).max(300),
    snippet: z.string().max(2_000).optional(),
    actionUrl: z.string().max(2_000).optional(),
  })
  .strict();

const registry = new Map<string, z.ZodTypeAny>([
  ['probe.question', ProbeQuestionPayloadSchema],
  ['probe.digest', ProbeDigestPayloadSchema],
  ['probe.answer_acknowledged', ProbeAnswerAckPayloadSchema],
  ['curation.pending', CurationPendingPayloadSchema],
  ['system.message', SystemMessagePayloadSchema],
  ['chat.answer', ChatAnswerPayloadSchema],
  ['specialist.probe', SpecialistProbePayloadSchema],
  ['idea.status_changed', IdeaStatusChangedPayloadSchema],
  ['checkin.prompt', CheckinPromptPayloadSchema],
  ['proactive.notification', ProactiveNotificationPayloadSchema],
  ['operations.weekly_digest', OperationsWeeklyDigestPayloadSchema],
  ['goals.pulse', GoalsPulsePayloadSchema],
  ['operations.monthly_recap', OperationsMonthlyRecapPayloadSchema],
  ['issue.mention', IssueMentionPayloadSchema],
  ['event.reminder', EventReminderPayloadSchema],
  ['clone.access_granted', CloneAccessGrantedPayloadSchema],
  ['checkin.ack', CheckinAckPayloadSchema],
  ['note.ack', NoteAckPayloadSchema],
  ['actions.reminder', ActionsReminderPayloadSchema],
  ['meeting.invite', MeetingInvitePayloadSchema],
  ['support.ticket_created', SupportTicketEventPayloadSchema],
  ['support.ticket_reply', SupportTicketEventPayloadSchema],
]);

export function validateEventPayload(eventType: string, payload: unknown): Record<string, unknown> {
  const schema = registry.get(eventType) ?? LiberalPayloadSchema;
  const parsed = schema.parse(payload);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `validateEventPayload: схема для eventType=${eventType} должна возвращать объект`,
    );
  }
  return parsed as Record<string, unknown>;
}
