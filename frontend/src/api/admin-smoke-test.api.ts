import { apiClient } from "./api-client";

export const ADMIN_SMOKE_TEST_PROVIDERS = [
  "openai",
  "deepseek",
  "anthropic",
  "ollama",
  "vox",
  "minimax",
  "grsai",
  "kie",
] as const;

export type AdminSmokeTestProvider =
  (typeof ADMIN_SMOKE_TEST_PROVIDERS)[number];

export type SmokeTestRunApi = {
  id?: string;
  provider: AdminSmokeTestProvider | string;
  status: "ok" | "fail";
  latencyMs: number | null;
  ranAt: string;
  message?: string | null;
};

export type AdminSmokeTestStatusApi = {
  providers: Array<{
    provider: AdminSmokeTestProvider | string;
    lastRun?: SmokeTestRunApi | null;
  }>;
};

export const adminSmokeTestApi = {
  run: (provider: AdminSmokeTestProvider | string) =>
    apiClient.post<SmokeTestRunApi>(
      `/api/v1/admin/ai/smoke-test/${encodeURIComponent(provider)}`,
      {},
    ),

  runAll: () =>
    apiClient.post<{ runs: SmokeTestRunApi[] }>(
      "/api/v1/admin/ai/smoke-test/all",
      {},
    ),

  history: (limit = 50) =>
    apiClient.get<{ items: SmokeTestRunApi[] }>(
      `/api/v1/admin/ai/smoke-test/history?limit=${limit}`,
    ),

  status: () =>
    apiClient.get<AdminSmokeTestStatusApi>(
      "/api/v1/admin/ai/smoke-test/status",
    ),
};
