import { apiClient } from "./api-client";

export type HighlightRenderStatus =
  | "none"
  | "queued"
  | "processing"
  | "ready"
  | "failed";

export type HighlightApi = {
  id: string;
  meetingId: string;
  title: string;
  startMs: number;
  endMs: number;
  renderStatus: HighlightRenderStatus;
  mp4Url: string | null;
  durationMs: number;
  createdAt: string;
};

export type HighlightListApiResponse = { items: HighlightApi[] };

export type CreateHighlightRequest = {
  startMs: number;
  endMs: number;
  title: string;
};

export type UpdateHighlightRequest = Partial<CreateHighlightRequest>;

export type HighlightDownloadApiResponse = {
  url: string;
  expiresAt: string;
};

export const highlightsApi = {
  listForMeeting: (meetingId: string) =>
    apiClient.get<HighlightListApiResponse>(
      `/api/v1/meetings/${encodeURIComponent(meetingId)}/highlights`,
    ),

  create: (meetingId: string, body: CreateHighlightRequest) =>
    apiClient.post<HighlightApi>(
      `/api/v1/meetings/${encodeURIComponent(meetingId)}/highlights`,
      body,
    ),

  update: (highlightId: string, body: UpdateHighlightRequest) =>
    apiClient.patch<HighlightApi>(
      `/api/v1/highlights/${encodeURIComponent(highlightId)}`,
      body,
    ),

  remove: (highlightId: string) =>
    apiClient.del<{ ok: true }>(
      `/api/v1/highlights/${encodeURIComponent(highlightId)}`,
    ),

  renderMp4: (highlightId: string) =>
    apiClient.post<{ ok: true; status: HighlightRenderStatus }>(
      `/api/v1/highlights/${encodeURIComponent(highlightId)}/render-mp4`,
    ),

  download: (highlightId: string) =>
    apiClient.get<HighlightDownloadApiResponse>(
      `/api/v1/highlights/${encodeURIComponent(highlightId)}/download`,
    ),
};
