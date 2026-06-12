import { apiClient } from './api-client';
import type { MeetingStatus, MeetingType, ParticipantRole } from '@/domain/enums';

// ───────────────────── Integration keys ─────────────────────

export type IntegrationKeyApi = {
  id: string;
  partnerName: string;
  createdAt: string;
  revokedAt: string | null;
};

export type IntegrationKeyCreateApiResponse = { id: string; key: string };

// ───────────────────── Meetings ─────────────────────

export type AdminMeetingListItemApi = {
  id: string;
  title: string;
  type: MeetingType;
  status: MeetingStatus;
  ownerId: string;
  ownerEmail: string;
  ownerName: string;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
};

export type AdminMeetingsListApiResponse = {
  items: AdminMeetingListItemApi[];
  total: number;
  page: number;
  limit: number;
};

export type AdminMeetingDetailsApi = {
  meeting: {
    id: string;
    title: string;
    type: MeetingType;
    status: MeetingStatus;
    customPrompt: string | null;
    failureReason: string | null;
    startedAt: string | null;
    endedAt: string | null;
    createdAt: string;
    owner: { id: string; externalId: string | null; email: string; name: string };
    /// quality_score, целиком сгенерированный воркером meeting-report-fast.
    /// Структура: { overallScore, categories, recommendations[], strengths[] }
    /// (см. backend `meeting-report-fast.prompt.ts`). NULL пока не сгенерирован.
    qualityScore: Record<string, unknown> | null;
  };
  participants: Array<{
    id: string;
    name: string;
    role: ParticipantRole;
    livekitIdentity: string;
    isRegisteredUser: boolean;
    userId: string | null;
    joinedAt: string | null;
    leftAt: string | null;
  }>;
  recording: {
    id: string;
    status: string;
    retentionDays: number;
    expiresAt: string;
    mainVideoUrl: string | null;
    compositeEgressId: string | null;
    bytesTotal: string | null;
    durationSeconds: number | null;
    audioTracks: Array<{
      id: string;
      participantName: string;
      livekitIdentity: string;
      audioUrl: string;
      durationSeconds: number;
      bytes: string | null;
    }>;
  } | null;
  transcript: {
    id: string;
    rawIndexS3Url: string;
    mergedS3Url: string | null;
    totalWords: number | null;
    totalDurationSeconds: number | null;
    createdAt: string;
  } | null;
  aiResult: {
    id: string;
    summary: string;
    structuredData: unknown;
    customOutputMd: string | null;
    followUpEmail: string | null;
    tasks: unknown;
    modelUsed: string;
    createdAt: string;
    summaryFast: string | null;
    summaryFastModel: string | null;
    summaryFastGeneratedAt: string | null;
  } | null;
  reportStatuses: {
    reportFast: {
      status: string | null;
      error: string | null;
      generatedAt: string | null;
    };
  };
  chapters: Array<{
    id: string;
    title: string;
    summary: string | null;
    startMs: number;
    endMs: number;
    extractorVersion: string | null;
    createdAt: string;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    description: string | null;
    status: string;
    assigneeRaw: string | null;
    assigneeUserId: string | null;
    dueDate: string | null;
    extractorVersion: string | null;
    sourceQuote: string | null;
    confidence: number | null;
    createdAt: string;
  }>;
  events: Array<{
    id: string;
    eventType: string;
    payload: unknown;
    receivedAt: string;
  }>;
};

// ───────────────────── AI Usage ─────────────────────

export type AdminAiUsageApiResponse = {
  from: string;
  to: string;
  group_by: 'day' | 'model' | 'meeting_type';
  items: Array<{ key: string; count: number; costUsd: number }>;
};

// ───────────────────── Expiring recordings ─────────────────────

export type ExpiringRecordingApi = {
  id: string;
  meetingId: string;
  meetingTitle: string;
  status: string;
  retentionDays: number;
  expiresAt: string;
  durationSeconds: number | null;
  bytesTotal: string | null;
};

export type ExpiringRecordingsApiResponse = {
  items: ExpiringRecordingApi[];
  withinHours: number;
};

// ───────────────────── helpers ─────────────────────

function buildQuery(params: Record<string, string | number | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    usp.set(k, String(v));
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : '';
}

// ───────────────────── api ─────────────────────

export const adminApi = {
  // Auth
  adminLogin: (email: string, password: string) =>
    apiClient.post<{ ok: true }>('/api/v1/auth/admin-login', { email, password }),

  // Integration keys
  listKeys: () =>
    apiClient.get<{ items: IntegrationKeyApi[] }>('/admin/api/v1/integration-keys'),

  createKey: (partnerName: string) =>
    apiClient.post<IntegrationKeyCreateApiResponse>(
      '/admin/api/v1/integration-keys',
      { partner_name: partnerName },
    ),

  revokeKey: (id: string) =>
    apiClient.del<{ ok: true }>(
      `/admin/api/v1/integration-keys/${encodeURIComponent(id)}`,
    ),

  // Meetings
  listMeetings: (opts: {
    status?: MeetingStatus;
    type?: MeetingType;
    owner_id?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }) =>
    apiClient.get<AdminMeetingsListApiResponse>(
      `/admin/api/v1/meetings${buildQuery({
        status: opts.status,
        type: opts.type,
        owner_id: opts.owner_id,
        from: opts.from,
        to: opts.to,
        page: opts.page,
        limit: opts.limit,
      })}`,
    ),

  getMeeting: (id: string) =>
    apiClient.get<AdminMeetingDetailsApi>(
      `/admin/api/v1/meetings/${encodeURIComponent(id)}`,
    ),

  forceFinish: (id: string) =>
    apiClient.post<{ ok: true; status: MeetingStatus }>(
      `/admin/api/v1/meetings/${encodeURIComponent(id)}/force-finish`,
      {},
    ),

  retryAi: (id: string) =>
    apiClient.post<{ ok: true; stage: string }>(
      `/admin/api/v1/meetings/${encodeURIComponent(id)}/retry-ai`,
      {},
    ),

  // AI Usage
  aiUsage: (opts: { from: string; to: string; group_by: 'day' | 'model' | 'meeting_type' }) =>
    apiClient.get<AdminAiUsageApiResponse>(
      `/admin/api/v1/ai-usage${buildQuery({
        from: opts.from,
        to: opts.to,
        group_by: opts.group_by,
      })}`,
    ),

  // Expiring recordings
  expiringRecordings: (withinHours: number) =>
    apiClient.get<ExpiringRecordingsApiResponse>(
      `/admin/api/v1/recordings/expiring${buildQuery({ within_hours: withinHours })}`,
    ),
};
