import { apiClient } from './api-client';

/**
 * API DTO для модуля tags.
 * Источник правды — backend/src/modules/tags/.
 */

export type TagApi = {
  id: string;
  name: string;
  color: string | null;
  meetingCount?: number;
  createdAt: string;
};

export type TagListApiResponse = { items: TagApi[] };

export type CreateTagRequest = { name: string; color?: string | null };
export type UpdateTagRequest = Partial<CreateTagRequest>;

export type SetMeetingTagsRequest = { tagIds: string[] };

export const tagsApi = {
  list: () => apiClient.get<TagListApiResponse>(`/api/v1/tags`),

  create: (body: CreateTagRequest) =>
    apiClient.post<TagApi>(`/api/v1/tags`, body),

  update: (tagId: string, body: UpdateTagRequest) =>
    apiClient.patch<TagApi>(`/api/v1/tags/${encodeURIComponent(tagId)}`, body),

  remove: (tagId: string) =>
    apiClient.del<{ ok: true }>(`/api/v1/tags/${encodeURIComponent(tagId)}`),

  listForMeeting: (meetingId: string) =>
    apiClient.get<TagListApiResponse>(
      `/api/v1/meetings/${encodeURIComponent(meetingId)}/tags`,
    ),

  setForMeeting: (meetingId: string, body: SetMeetingTagsRequest) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/meetings/${encodeURIComponent(meetingId)}/tags`,
      body,
    ),
};
