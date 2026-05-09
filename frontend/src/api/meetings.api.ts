import { apiClient } from './api-client';
import type {
  AccessApi,
  MeetingApi,
  MeetingSummaryApi,
  ParticipantApi,
} from '@/domain/meeting';
import type { AiResultApi } from '@/domain/ai-result';
import type { MeetingStatus, MeetingType } from '@/domain/enums';

// ─────────────────── DTO returned by backend ──────────────────

export type ListMeetingsApiResponse = {
  items: MeetingSummaryApi[];
  page: number;
  limit: number;
  total: number;
};

export type CreateMeetingApiRequest = {
  type: MeetingType;
  title: string;
  custom_prompt?: string | null;
};

export type CreateMeetingApiResponse = { id: string; url: string };

export type JoinMeetingApiRequest = { guest_name?: string };

export type JoinMeetingApiResponse = {
  participant_id: string;
  role: 'host' | 'guest';
  livekit_identity: string;
  livekit: { url: string; token: string; identity: string };
};

export type DownloadUrlApiResponse = { url: string; expires_at: string };

export type MeetingDetailApi = MeetingApi & {
  participants: Array<
    ParticipantApi & {
      livekitIdentity: string;
      isRegisteredUser: boolean;
    }
  >;
};

export type ResultApiResponse = {
  meeting: MeetingApi;
  participants: ParticipantApi[];
  aiResult: AiResultApi | null;
  recording: {
    hasRecording: boolean;
    status: string;
    durationSeconds: number | null;
    bytesTotal: string | null;
    expiresAt: string | null;
  } | null;
  transcript: {
    hasMerged: boolean;
    totalDurationSeconds: number | null;
  } | null;
  aiReady: boolean;
};

export type ResultStatusApiResponse = {
  stage: MeetingStatus;
  failureReason: string | null;
};

export type TranscriptApiResponse = {
  url: string;
  expiresAt: string;
  durationSeconds: number | null;
};

// ─────────────────── helpers ──────────────────

function buildListQuery(opts: {
  page?: number;
  limit?: number;
  status?: MeetingStatus;
  type?: MeetingType;
}): string {
  const params = new URLSearchParams();
  if (opts.page) params.set('page', String(opts.page));
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.status) params.set('status', opts.status);
  if (opts.type) params.set('type', opts.type);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

// ─────────────────── api ──────────────────

export const meetingsApi = {
  list: (opts: {
    page?: number;
    limit?: number;
    status?: MeetingStatus;
    type?: MeetingType;
  }) =>
    apiClient.get<ListMeetingsApiResponse>(
      `/api/v1/meetings${buildListQuery(opts)}`,
    ),

  create: (body: CreateMeetingApiRequest) =>
    apiClient.post<CreateMeetingApiResponse>('/api/v1/meetings', body),

  get: (id: string) =>
    apiClient.get<MeetingDetailApi>(`/api/v1/meetings/${encodeURIComponent(id)}`),

  access: (id: string) =>
    apiClient.get<AccessApi>(
      `/api/v1/meetings/${encodeURIComponent(id)}/access`,
    ),

  join: (id: string, body: JoinMeetingApiRequest) =>
    apiClient.post<JoinMeetingApiResponse>(
      `/api/v1/meetings/${encodeURIComponent(id)}/join`,
      body,
    ),

  finish: (id: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/meetings/${encodeURIComponent(id)}/finish`,
    ),

  startRecording: (id: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/meetings/${encodeURIComponent(id)}/recording/start`,
    ),

  stopRecording: (id: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/meetings/${encodeURIComponent(id)}/recording/stop`,
    ),

  downloadUrl: (id: string) =>
    apiClient.get<DownloadUrlApiResponse>(
      `/api/v1/meetings/${encodeURIComponent(id)}/recording/download`,
    ),

  deleteRecording: (id: string) =>
    apiClient.del<{ ok: true }>(
      `/api/v1/meetings/${encodeURIComponent(id)}/recording`,
    ),

  muteParticipant: (id: string, pid: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/meetings/${encodeURIComponent(id)}/participants/${encodeURIComponent(pid)}/mute`,
    ),

  unmuteParticipant: (id: string, pid: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/meetings/${encodeURIComponent(id)}/participants/${encodeURIComponent(pid)}/unmute`,
    ),

  kickParticipant: (id: string, pid: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/meetings/${encodeURIComponent(id)}/participants/${encodeURIComponent(pid)}/kick`,
    ),

  lowerHand: (id: string, pid: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/meetings/${encodeURIComponent(id)}/participants/${encodeURIComponent(pid)}/lower-hand`,
    ),

  retryAi: (id: string) =>
    apiClient.post<{ ok: true; stage: string }>(
      `/api/v1/meetings/${encodeURIComponent(id)}/retry-ai`,
    ),

  result: (id: string) =>
    apiClient.get<ResultApiResponse>(
      `/api/v1/meetings/${encodeURIComponent(id)}/result`,
    ),

  resultStatus: (id: string) =>
    apiClient.get<ResultStatusApiResponse>(
      `/api/v1/meetings/${encodeURIComponent(id)}/result/status`,
    ),

  transcript: (id: string) =>
    apiClient.get<TranscriptApiResponse>(
      `/api/v1/meetings/${encodeURIComponent(id)}/transcript`,
    ),
};
