import { apiClient } from "./api-client";
import type {
  CreateGlobalChannelRequest,
  GlobalChannelItemApi,
  GlobalChannelListApi,
  UpdateGlobalChannelRequest,
} from "@/domain/admin-global-channel";

export const adminGlobalChannelsApi = {
  list: () =>
    apiClient.get<GlobalChannelListApi>(
      "/api/v1/admin/content/global-channels",
    ),

  create: (body: CreateGlobalChannelRequest) =>
    apiClient.post<GlobalChannelItemApi>(
      "/api/v1/admin/content/global-channels",
      body,
    ),

  update: (id: string, body: UpdateGlobalChannelRequest) =>
    apiClient.patch<GlobalChannelItemApi>(
      `/api/v1/admin/content/global-channels/${encodeURIComponent(id)}`,
      body,
    ),

  remove: (id: string) =>
    apiClient.del<{ ok: true }>(
      `/api/v1/admin/content/global-channels/${encodeURIComponent(id)}`,
    ),
};
