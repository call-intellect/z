/**
 * API DTO для behavior-metrics (Фаза B §8).
 *
 * Источник правды — backend/src/modules/behavior-metrics/.
 */

import { apiClient } from './api-client';

export type BehaviorMetricsStatusApi =
  | 'pending'
  | 'ready'
  | 'failed'
  | 'low_confidence';

export type BehaviorMeetingMetricsApi = {
  totalDurationMs: number;
  totalSpeechMs: number;
  silenceMs: number;
  silencePercent: number;
  crossTalkMs: number;
  dominanceIndex: number;
  lowConfidence: boolean;
  diarizationConfidence: number;
  computedAt: string;
};

export type BehaviorParticipantMetricsApi = {
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
};

export type BehaviorMetricsResponseApi = {
  status: BehaviorMetricsStatusApi;
  meeting: BehaviorMeetingMetricsApi | null;
  participants: BehaviorParticipantMetricsApi[];
};

export type BehaviorOrgAggregateParticipantApi = {
  userId: string | null;
  displayName: string;
  totalMeetings: number;
  avgSpeakingPercent: number;
  avgQuestionsPerMeeting: number;
  avgFillerWordsPerMeeting: number;
};

export type BehaviorOrgAggregateResponseApi = {
  tenantId: string;
  meetingsCount: number;
  avgDominanceIndex: number;
  avgSilencePercent: number;
  participants: BehaviorOrgAggregateParticipantApi[];
};

export const behaviorMetricsApi = {
  getForMeeting: (meetingId: string) =>
    apiClient.get<BehaviorMetricsResponseApi>(
      `/api/v1/meetings/${encodeURIComponent(meetingId)}/behavior-metrics`,
    ),

  getOrgAggregate: (params: {
    from?: string;
    to?: string;
    meetingType?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.meetingType) qs.set('meetingType', params.meetingType);
    const suffix = qs.toString();
    return apiClient.get<BehaviorOrgAggregateResponseApi>(
      `/api/v1/org/behavior-metrics/aggregate${suffix ? `?${suffix}` : ''}`,
    );
  },
};
