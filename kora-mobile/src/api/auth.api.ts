import { apiClient } from "./client";

export type UserRoleApi = "user" | "admin";

export interface UserApi {
  id: string;
  email: string;
  name: string;
  role: UserRoleApi;
}

export interface LoginResponseApi {
  user: UserApi;
  role: UserRoleApi;
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
}

export const authApi = {
  login: (email: string, password: string) =>
    apiClient.post<LoginResponseApi>(
      "/api/v1/auth/login",
      { email, password },
      { withOrg: false, captureSessionCookie: true },
    ),
  me: () => apiClient.get<{ user: UserApi | null }>("/api/v1/auth/me"),
  logout: () =>
    apiClient.post<{ ok: true }>("/api/v1/auth/logout", undefined, {
      withOrg: false,
    }),
};
