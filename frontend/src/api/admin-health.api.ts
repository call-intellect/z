import { apiClient } from "./api-client";
import type { AdminHealthApi } from "@/domain/admin-health";

export const adminHealthApi = {
  get: () => apiClient.get<AdminHealthApi>("/api/v1/admin/health"),
};
