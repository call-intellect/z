import { apiClient } from "./api-client";
import type { MaintenanceStatusApiDto } from "@/domain/admin-maintenance";

const BASE = "/api/v1/admin/platform/maintenance";

export const adminMaintenanceApi = {
  status: (): Promise<MaintenanceStatusApiDto> =>
    apiClient.get<MaintenanceStatusApiDto>(BASE),

  backupNow: (reason: string): Promise<{ ok: true; jobId: string }> =>
    apiClient.post<{ ok: true; jobId: string }>(`${BASE}/backup-now`, {
      reason,
    }),

  reindexNow: (reason: string): Promise<{ ok: true; jobId: string }> =>
    apiClient.post<{ ok: true; jobId: string }>(`${BASE}/reindex-now`, {
      reason,
    }),
};
