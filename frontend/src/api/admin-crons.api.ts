import { apiClient } from "./api-client";
import type {
  CronRunHistoryApiDto,
  CronScheduleApiDto,
  CronScheduleWithHistoryApiDto,
} from "@/domain/admin-cron";

const BASE = "/api/v1/admin/crons";

export type UpdateCronRequest = {
  expression?: string;
  enabled?: boolean;
  reason?: string;
};

export const adminCronsApi = {
  list: (): Promise<CronScheduleApiDto[]> =>
    apiClient.get<CronScheduleApiDto[]>(BASE),

  listWithHistory: (): Promise<CronScheduleWithHistoryApiDto[]> =>
    apiClient.get<CronScheduleWithHistoryApiDto[]>(`${BASE}/with-history`),

  history: (
    name: string,
    limit = 20,
  ): Promise<{ items: CronRunHistoryApiDto[] }> =>
    apiClient.get<{ items: CronRunHistoryApiDto[] }>(
      `${BASE}/${encodeURIComponent(name)}/history?limit=${encodeURIComponent(String(limit))}`,
    ),

  update: (name: string, body: UpdateCronRequest): Promise<{ ok: true }> =>
    apiClient.patch<{ ok: true }>(`${BASE}/${encodeURIComponent(name)}`, body),

  runNow: (name: string): Promise<{ ok: boolean }> =>
    apiClient.post<{ ok: boolean }>(
      `${BASE}/${encodeURIComponent(name)}/run`,
      {},
    ),
};
