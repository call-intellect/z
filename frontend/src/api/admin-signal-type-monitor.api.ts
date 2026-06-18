import { apiClient } from "./api-client";
import type {
  AdminSignalTypeMonitorItemApi,
  AdminSignalTypeMonitorListApi,
} from "@/domain/admin-signal-type-monitor";

export const adminSignalTypeMonitorApi = {
  list: () =>
    apiClient.get<AdminSignalTypeMonitorListApi>(
      "/api/v1/admin/llm/signal-type-monitor",
    ),

  getByTenant: (tenantId: string) =>
    apiClient.get<AdminSignalTypeMonitorItemApi>(
      `/api/v1/admin/llm/signal-type-monitor/${encodeURIComponent(tenantId)}`,
    ),
};
