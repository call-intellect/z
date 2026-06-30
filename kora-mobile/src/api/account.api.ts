import { apiClient } from "./client";

export interface BlockedMemberApi {
  userId: string;
  name: string;
  conversationId: string;
  blockedAt: string;
}

export const accountApi = {
  deleteAccount: () =>
    apiClient.post<{ ok: true }>("/api/v1/account/delete"),

  listBlocked: () =>
    apiClient.get<{ items: BlockedMemberApi[] }>("/api/v1/account/blocked"),
};
