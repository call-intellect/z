import { apiClient } from "./api-client";
import type {
  CreateMeetingTypeRequest,
  MeetingTypeItemApi,
  MeetingTypeListApi,
  UpdateMeetingTypeRequest,
} from "@/domain/admin-meeting-type";

export const adminMeetingTypesApi = {
  list: () =>
    apiClient.get<MeetingTypeListApi>("/api/v1/admin/content/meeting-types"),

  create: (body: CreateMeetingTypeRequest) =>
    apiClient.post<MeetingTypeItemApi>(
      "/api/v1/admin/content/meeting-types",
      body,
    ),

  update: (id: string, body: UpdateMeetingTypeRequest) =>
    apiClient.patch<MeetingTypeItemApi>(
      `/api/v1/admin/content/meeting-types/${encodeURIComponent(id)}`,
      body,
    ),

  remove: (id: string) =>
    apiClient.del<{ ok: true }>(
      `/api/v1/admin/content/meeting-types/${encodeURIComponent(id)}`,
    ),
};
