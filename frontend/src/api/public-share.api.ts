import { apiClient } from './api-client';

/**
 * Публичные share-эндпоинты (без auth, под `/api/v1/public`).
 * Используются страницами `/share/[token]` и `/share/clip/[token]` —
 * страница вызывает их (server- или client-side) без cookie.
 */

export type PublicShareMeetingApi = {
  meeting: {
    id: string;
    title: string;
    type: string;
    durationMs: number;
    startedAt: string | null;
  };
  permissions: {
    allowVideo: boolean;
    allowTranscript: boolean;
    allowTasks: boolean;
    allowChapters: boolean;
    /** Разрешён ли публичный показ in-meeting чата участников. */
    allowChat: boolean;
  };
  /** In-meeting чат — приходит только если `permissions.allowChat=true`. */
  messages?: Array<{
    id: string;
    authorName: string;
    content: string;
    sentAt: string;
  }>;
  summary: string | null;
  tasks: Array<{
    id: string;
    title: string;
    assignee: string | null;
    dueDate: string | null;
    status: string;
  }> | null;
  chapters: Array<{
    id: string;
    startMs: number;
    endMs: number;
    title: string;
    summary: string | null;
  }> | null;
  videoUrl: string | null;
  transcript: Array<{
    id: string;
    startMs: number;
    speakerName: string | null;
    text: string;
  }> | null;
  expiresAt: string | null;
};

export type PublicShareClipApi = {
  highlight: {
    id: string;
    title: string;
    durationMs: number;
  };
  videoUrl: string;
  expiresAt: string | null;
};

export const publicShareApi = {
  /** Получить публичную встречу по токену. Вернёт 404 / 410 при невалидном/просроченном токене. */
  getMeeting: (token: string) =>
    apiClient.get<PublicShareMeetingApi>(
      `/api/v1/public/share/${encodeURIComponent(token)}`,
    ),

  /** Получить публичный клип. */
  getClip: (token: string) =>
    apiClient.get<PublicShareClipApi>(
      `/api/v1/public/share/clip/${encodeURIComponent(token)}`,
    ),
};
