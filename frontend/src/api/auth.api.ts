import { apiClient } from "./api-client";
import type { UserRole } from "@/domain/enums";

export type UserApi = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
};

export type UnifiedLoginResponse = {
  user: UserApi;
  role: UserRole;
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
};

export const authApi = {
  login: (body: { email: string; password: string }) =>
    apiClient.post<UnifiedLoginResponse>("/api/v1/auth/login", body),
  me: () => apiClient.get<{ user: UserApi | null }>("/api/v1/auth/me"),
  exchange: (token: string, meetingId: string) =>
    apiClient.get<{ ok: true; redirect: string }>(
      `/api/v1/auth/exchange?token=${encodeURIComponent(token)}&meeting_id=${encodeURIComponent(meetingId)}`,
    ),
  logout: () => apiClient.post<{ ok: true }>("/api/v1/auth/logout"),
};
