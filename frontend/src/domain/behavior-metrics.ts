import type {
  BehaviorMeetingMetricsApi,
  BehaviorMetricsResponseApi,
  BehaviorMetricsStatusApi,
  BehaviorOrgAggregateResponseApi,
  BehaviorParticipantMetricsApi,
} from "@/api/behavior-metrics.api";

export type BehaviorMetricsStatus = BehaviorMetricsStatusApi;

export interface BehaviorMeetingMetricsDomain {
  totalDurationMs: number;
  totalSpeechMs: number;
  silenceMs: number;
  silencePercent: number;
  crossTalkMs: number;
  dominanceIndex: number;
  lowConfidence: boolean;
  diarizationConfidence: number;
  computedAt: Date;
}

export interface BehaviorParticipantDomain {
  participantId: string | null;
  displayName: string;
  isGuest: boolean;
  speakingTimeMs: number;
  speakingTimePercent: number;
  turnsCount: number;
  avgTurnDurationMs: number;
  monologueCount: number;
  longestMonologueMs: number;
  questionCount: number;
  fillerWordsCount: number;
  interruptionsMadeCount: number;
  interruptionsReceivedCount: number;
}

export interface BehaviorMetricsDomain {
  status: BehaviorMetricsStatus;
  meeting: BehaviorMeetingMetricsDomain | null;
  participants: BehaviorParticipantDomain[];
}

export function behaviorMetricsFromApi(
  dto: BehaviorMetricsResponseApi,
): BehaviorMetricsDomain {
  return {
    status: dto.status,
    meeting: dto.meeting ? meetingFromApi(dto.meeting) : null,
    participants: dto.participants.map(participantFromApi),
  };
}

function meetingFromApi(
  m: BehaviorMeetingMetricsApi,
): BehaviorMeetingMetricsDomain {
  return {
    totalDurationMs: m.totalDurationMs,
    totalSpeechMs: m.totalSpeechMs,
    silenceMs: m.silenceMs,
    silencePercent: m.silencePercent,
    crossTalkMs: m.crossTalkMs,
    dominanceIndex: m.dominanceIndex,
    lowConfidence: m.lowConfidence,
    diarizationConfidence: m.diarizationConfidence,
    computedAt: new Date(m.computedAt),
  };
}

function participantFromApi(
  p: BehaviorParticipantMetricsApi,
): BehaviorParticipantDomain {
  return { ...p };
}

export function isDiarizationDegenerate(
  m: BehaviorMeetingMetricsDomain | null,
): boolean {
  if (!m || !m.lowConfidence || m.totalDurationMs <= 0) return false;
  return m.totalSpeechMs > m.totalDurationMs * 1.5;
}

export interface BehaviorOrgAggregateParticipantDomain {
  userId: string | null;
  displayName: string;
  totalMeetings: number;
  avgSpeakingPercent: number;
  avgQuestionsPerMeeting: number;
  avgFillerWordsPerMeeting: number;
}

export interface BehaviorOrgAggregateDomain {
  tenantId: string;
  meetingsCount: number;
  avgDominanceIndex: number;
  avgSilencePercent: number;
  participants: BehaviorOrgAggregateParticipantDomain[];
}

export function behaviorOrgAggregateFromApi(
  dto: BehaviorOrgAggregateResponseApi,
): BehaviorOrgAggregateDomain {
  return {
    tenantId: dto.tenantId,
    meetingsCount: dto.meetingsCount,
    avgDominanceIndex: dto.avgDominanceIndex,
    avgSilencePercent: dto.avgSilencePercent,
    participants: dto.participants.map((p) => ({ ...p })),
  };
}
