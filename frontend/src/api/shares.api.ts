import { apiClient } from "./api-client";

export type ShareScope = "meeting" | "highlight";

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
  allowChat?: boolean;
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

  createHighlightShare: (
    highlightId: string,
    body: CreateHighlightShareRequest,
  ) =>
    apiClient.post<ShareApi>(
      `/api/v1/highlights/${encodeURIComponent(highlightId)}/shares`,
      body,
    ),

  revoke: (shareId: string) =>
    apiClient.del<{ ok: true }>(
      `/api/v1/shares/${encodeURIComponent(shareId)}`,
    ),
};
