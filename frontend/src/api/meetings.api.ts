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
  templateId?: string | null;
  /**
   * Опциональная привязка к карточке. Если задано — встреча создаётся уже
   * привязанной к карточке (deeplink-сценарий «Создать встречу из карточки»).
   */
  card_id?: string | null;
  record_by_default?: boolean;
  /**
   * Приглашённые сотрудники/контакты (Фаза 2). Backend (Фаза 2.1) pre-seed'ит
   * `Participant` с `userId`/`personId` и шлёт приглашение по выбранным
   * каналам `sendVia` (почта / Telegram).
   */
  invitees?: Array<{
    userId?: string | null;
    personId?: string | null;
    email?: string | null;
    sendVia?: ('email' | 'telegram')[];
  }>;
  /**
   * ТЗ 2026-06-06 knowledge-access (Ф7) — закрытость встречи. Опционально.
   * null/опущено = знание встречи открыто; иначе блоки встречи привязываются
   * к закрытой группе: «руководство» / «совет» / «личное».
   */
  closed_group_kind?: 'leadership' | 'council' | 'personal' | null;
};

export type ListMeetingsApiRequest = {
  page?: number;
  limit?: number;
  status?: MeetingStatus | MeetingStatus[];
  type?: MeetingType | MeetingType[];
  query?: string;
  dateFrom?: string;
  dateTo?: string;
  tagIds?: string[];
  cardId?: string;
};

export type RegenerateMeetingApiRequest = {
  expectedRecapVersion: number;
  templateId?: string | null;
};

export type RegenerateSectionApiRequest = {
  expectedRecapVersion: number;
  sectionKey: string;
};

export type CreateMeetingApiResponse = { id: string; url: string };

/**
 * Тело POST /meetings/:id/invitees (Фаза B5) — добавить приглашённых к уже
 * созданной встрече. Backend host-only, идемпотентен (повторные дубликаты
 * пропускаются), разрешён для joinable-встречи.
 */
export type AddInviteesApiRequest = {
  invitees: Array<{
    userId?: string | null;
    personId?: string | null;
    email?: string | null;
    sendVia?: ('email' | 'telegram')[];
  }>;
};

export type AddInviteesApiResponse = { added: number; skipped: number };

export type JoinMeetingApiRequest = {
  guest_name?: string;
  /**
   * Персональный токен приглашения (Ф3.1, backend DTO `JoinMeetingSchema`).
   * Передаётся при входе по ссылке `/m/:id?inv=<inviteToken>` — backend
   * резолвит pre-seeded `Participant` по токену вместо создания нового
   * анонимного гостя.
   */
  invite_token?: string;
};

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
  /**
   * Commercial-reliability pack (Фаза 3) — `isRegisteredUser` нужен UI для
   * показа inline-edit «карандашика» только у гостей.
   */
  participants: Array<ParticipantApi & { isRegisteredUser: boolean }>;
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

export type TranscriptTurn = {
  speaker: string;
  text: string;
  startSec: number;
  endSec: number;
};

export type TranscriptApiResponse = {
  turns: TranscriptTurn[];
  durationSeconds: number | null;
  roomChat?: Array<{ sentAt: string; authorName: string; content: string }>;
};

/** Ответ POST /meetings/:id/transcript/clean. */
export type CleanTranscriptApiResponse = {
  status: 'queued' | 'already_clean';
};

export type AudioTrackApi = {
  id: string;
  participantName: string;
  livekitIdentity: string;
  durationSeconds: number;
  url: string;
  expiresAt: string;
};

export type AudioTracksApiResponse = {
  tracks: AudioTrackApi[];
};

// ─────────────────── helpers ──────────────────

function buildListQuery(opts: ListMeetingsApiRequest): string {
  const params = new URLSearchParams();
  if (opts.page) params.set('page', String(opts.page));
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.status) {
    if (Array.isArray(opts.status)) {
      for (const s of opts.status) params.append('status', s);
    } else {
      params.set('status', opts.status);
    }
  }
  if (opts.type) {
    if (Array.isArray(opts.type)) {
      for (const tt of opts.type) params.append('type', tt);
    } else {
      params.set('type', opts.type);
    }
  }
  if (opts.query) params.set('query', opts.query);
  if (opts.dateFrom) params.set('dateFrom', opts.dateFrom);
  if (opts.dateTo) params.set('dateTo', opts.dateTo);
  if (opts.tagIds) {
    for (const id of opts.tagIds) params.append('tagId', id);
  }
  if (opts.cardId) params.set('cardId', opts.cardId);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

// ─────────────────── api ──────────────────

export const meetingsApi = {
  list: (opts: ListMeetingsApiRequest) =>
    apiClient.get<ListMeetingsApiResponse>(
      `/api/v1/meetings${buildListQuery(opts)}`,
    ),

  // X-Org-Id добавляется api-client'ом по умолчанию (текущая Org из auth-context).
  // Нужен глобальному SubscriptionGuard на бэке. См. api-client.setApiClientOrgId.
  create: (body: CreateMeetingApiRequest) =>
    apiClient.post<CreateMeetingApiResponse>('/api/v1/meetings', body),

  /**
   * Фаза B5 — добавить приглашённых к существующей встрече. Host-only,
   * идемпотентно. Возвращает счётчики `added` / `skipped`.
   */
  addInvitees: (id: string, body: AddInviteesApiRequest) =>
    apiClient.post<AddInviteesApiResponse>(
      `/api/v1/meetings/${encodeURIComponent(id)}/invitees`,
      body,
    ),

  /**
   * ТЗ 2026-06-06 knowledge-access (Ф7) — задать закрытость встречи постфактум
   * (host-only). null = открыто; 'leadership' | 'council' | 'personal'.
   */
  setClosedGroup: (
    id: string,
    closedGroupKind: 'leadership' | 'council' | 'personal' | null,
  ) =>
    apiClient.patch<{ id: string; closedGroupKind: string | null }>(
      `/api/v1/meetings/${encodeURIComponent(id)}/closed-group`,
      { closedGroupKind },
    ),

  /** Soft-delete встречи. */
  softDelete: (id: string) =>
    apiClient.del<{ ok: true }>(`/api/v1/meetings/${encodeURIComponent(id)}`),

  regenerate: (id: string, body: RegenerateMeetingApiRequest) =>
    apiClient.post<{ ok: true; queued: boolean }>(
      `/api/v1/meetings/${encodeURIComponent(id)}/regenerate`,
      body,
    ),

  regenerateSection: (id: string, body: RegenerateSectionApiRequest) =>
    apiClient.post<{ ok: true; queued: boolean }>(
      `/api/v1/meetings/${encodeURIComponent(id)}/regenerate-section`,
      body,
    ),

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

  /**
   * Commercial-reliability pack (Фаза 3) — Zoom-модель: хост переименовывает
   * гостя (`isRegisteredUser=false`) после встречи.
   */
  renameParticipant: (id: string, pid: string, body: { name: string }) =>
    apiClient.patch<{ id: string; name: string }>(
      `/api/v1/meetings/${encodeURIComponent(id)}/participants/${encodeURIComponent(pid)}`,
      body,
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

  transcript: (id: string, opts?: { cleaned?: boolean }) =>
    apiClient.get<TranscriptApiResponse>(
      `/api/v1/meetings/${encodeURIComponent(id)}/transcript${
        opts?.cleaned ? '?cleaned=true' : ''
      }`,
    ),

  /**
   * Фаза D — запустить очистку транскрипта от слов-паразитов.
   * Rate-limit на сервере: 1 в час на пользователя.
   */
  cleanTranscript: (id: string) =>
    apiClient.post<CleanTranscriptApiResponse>(
      `/api/v1/meetings/${encodeURIComponent(id)}/transcript/clean`,
    ),

  audioTracks: (id: string) =>
    apiClient.get<AudioTracksApiResponse>(
      `/api/v1/meetings/${encodeURIComponent(id)}/recording/audio-tracks`,
    ),
};
