import { apiClient } from "./api-client";

export type ChapterApi = {
  id: string;
  meetingId: string;
  startMs: number;
  endMs: number;
  title: string;
  summary: string | null;
  source: "ai" | "manual";
  orderIndex: number;
  createdAt: string;
  extractorVersion: string | null;
};

export type ChapterListApiResponse = { items: ChapterApi[] };

export type CreateChapterRequest = {
  startMs: number;
  endMs: number;
  title: string;
  summary?: string | null;
};

export type UpdateChapterRequest = Partial<CreateChapterRequest>;

export const chaptersApi = {
  listForMeeting: (meetingId: string) =>
    apiClient.get<ChapterListApiResponse>(
      `/api/v1/meetings/${encodeURIComponent(meetingId)}/chapters`,
    ),

  create: (meetingId: string, body: CreateChapterRequest) =>
    apiClient.post<ChapterApi>(
      `/api/v1/meetings/${encodeURIComponent(meetingId)}/chapters`,
      body,
    ),

  update: (chapterId: string, body: UpdateChapterRequest) =>
    apiClient.patch<ChapterApi>(
      `/api/v1/chapters/${encodeURIComponent(chapterId)}`,
      body,
    ),

  remove: (chapterId: string) =>
    apiClient.del<{ ok: true }>(
      `/api/v1/chapters/${encodeURIComponent(chapterId)}`,
    ),

  regenerate: (meetingId: string) =>
    apiClient.post<{ ok: true; queued: boolean }>(
      `/api/v1/meetings/${encodeURIComponent(meetingId)}/chapters/regenerate`,
    ),
};
