import { apiClient } from './api-client';

/**
 * API DTO для модуля shares (приватные share-ссылки на встречи / клипы).
 * Источник правды — backend/src/modules/shares/.
 *
 * Публичные эндпоинты (без auth) — в `public-share.api.ts`.
 */

export type ShareScope = 'meeting' | 'highlight';

export type ShareApi = {
  id: string;
  scope: ShareScope;
  resourceId: string;
  token: string;
  url: string;
  allowVideo: boolean;
  allowTranscript: boolean;
  allowTasks: boolean;
  allowChapters: boolean;
  /** Разрешить публичный показ in-meeting чата участников. */
  allowChat: boolean;
  expiresAt: string | null;
  viewCount: number;
  createdAt: string;
};

export type ShareListApiResponse = { items: ShareApi[] };

export type CreateMeetingShareRequest = {
  allowVideo: boolean;
  allowTranscript: boolean;
  allowTasks: boolean;
  allowChapters: boolean;
  /** Разрешить публичный показ in-meeting чата участников. Default false. */
  allowChat?: boolean;
  /** Сколько дней живёт ссылка. Бэк ограничивает множеством {1,7,14}. */
  expirationDays: 1 | 7 | 14;
};

export type CreateHighlightShareRequest = {
  expirationDays: 1 | 7 | 14;
};

export const sharesApi = {
  listForMeeting: (meetingId: string) =>
    apiClient.get<ShareListApiResponse>(
      `/api/v1/meetings/${encodeURIComponent(meetingId)}/shares`,
    ),

  createMeetingShare: (meetingId: string, body: CreateMeetingShareRequest) =>
    apiClient.post<ShareApi>(
      `/api/v1/meetings/${encodeURIComponent(meetingId)}/shares`,
      body,
    ),

  listForHighlight: (highlightId: string) =>
    apiClient.get<ShareListApiResponse>(
      `/api/v1/highlights/${encodeURIComponent(highlightId)}/shares`,
    ),

  createHighlightShare: (highlightId: string, body: CreateHighlightShareRequest) =>
    apiClient.post<ShareApi>(
      `/api/v1/highlights/${encodeURIComponent(highlightId)}/shares`,
      body,
    ),

  revoke: (shareId: string) =>
    apiClient.del<{ ok: true }>(`/api/v1/shares/${encodeURIComponent(shareId)}`),
};
