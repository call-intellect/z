import { apiClient } from "./api-client";

export type SmokeTestRunApi = {
  id?: string;
  provider: string;
  status: "ok" | "fail";
  latencyMs: number | null;
  startedAt: string;
  error?: string;
  reply?: string;
};

export const adminSmokeTestApi = {
  run: (provider: string) =>
    apiClient.post<SmokeTestRunApi>(
      `/api/v1/admin/ai/smoke-test/${encodeURIComponent(provider)}`,
      {},
    ),

  runAll: () =>
    apiClient.post<{ items: SmokeTestRunApi[] }>(
      "/api/v1/admin/ai/smoke-test/all",
      {},
    ),

  history: (limit = 50) =>
    apiClient.get<{ items: SmokeTestRunApi[] }>(
      `/api/v1/admin/ai/smoke-test/history?limit=${limit}`,
    ),
};
