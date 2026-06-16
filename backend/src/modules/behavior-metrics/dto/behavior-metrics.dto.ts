import { z } from 'zod';

const ParticipantMetricsSchema = z.object({
  participantId: z.string().nullable(),
  displayName: z.string(),
  isGuest: z.boolean(),
  speakingTimeMs: z.number().int().nonnegative(),
  speakingTimePercent: z.number().nonnegative(),
  turnsCount: z.number().int().nonnegative(),
  avgTurnDurationMs: z.number().nonnegative(),
  monologueCount: z.number().int().nonnegative(),
  longestMonologueMs: z.number().int().nonnegative(),
  questionCount: z.number().int().nonnegative(),
  fillerWordsCount: z.number().int().nonnegative(),
  interruptionsMadeCount: z.number().int().nonnegative(),
  interruptionsReceivedCount: z.number().int().nonnegative(),
});

const MeetingMetricsSchema = z.object({
  totalDurationMs: z.number().int().nonnegative(),
  totalSpeechMs: z.number().int().nonnegative(),
  silenceMs: z.number().int().nonnegative(),
  silencePercent: z.number(),
  crossTalkMs: z.number().int().nonnegative(),
  dominanceIndex: z.number(),
  lowConfidence: z.boolean(),
  diarizationConfidence: z.number(),
  computedAt: z.string().datetime(),
});

export const BehaviorMetricsResponseSchema = z.object({
  status: z.enum(['pending', 'ready', 'failed', 'low_confidence']),
  meeting: MeetingMetricsSchema.nullable(),
  participants: z.array(ParticipantMetricsSchema),
});

export type BehaviorMetricsResponse = z.infer<typeof BehaviorMetricsResponseSchema>;

export const OrgAggregateQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  meetingType: z.string().optional(),
});
export type OrgAggregateQuery = z.infer<typeof OrgAggregateQuerySchema>;

export const OrgAggregateParticipantSchema = z.object({
  userId: z.string().nullable(),
  displayName: z.string(),
  totalMeetings: z.number().int().nonnegative(),
  avgSpeakingPercent: z.number(),
  avgQuestionsPerMeeting: z.number(),
  avgFillerWordsPerMeeting: z.number(),
});

export const OrgAggregateResponseSchema = z.object({
  meetingsCount: z.number().int().nonnegative(),
  avgDominanceIndex: z.number(),
  avgSilencePercent: z.number(),
  participants: z.array(OrgAggregateParticipantSchema),
});

export type OrgAggregateResponse = z.infer<typeof OrgAggregateResponseSchema>;
