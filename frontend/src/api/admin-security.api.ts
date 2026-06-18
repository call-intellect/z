import { apiClient } from "./api-client";

const BASE = "/api/v1/admin/platform/security";

export const adminSecurityApi = {
  rotateIpSalt: (reason: string): Promise<{ ok: true; rotatedAt: string }> =>
    apiClient.post<{ ok: true; rotatedAt: string }>(`${BASE}/rotate-ip-salt`, {
      reason,
    }),
};
