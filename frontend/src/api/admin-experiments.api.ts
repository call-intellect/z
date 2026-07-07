import { apiClient } from "./api-client";
import type {
  AdminFunctionDetailApi,
  AdminFunctionListApi,
} from "@/domain/admin-experiment";

export const adminFunctionsApi = {
  list: () => apiClient.get<AdminFunctionListApi>("/api/v1/admin/functions"),

  detail: (taskType: string) =>
    apiClient.get<AdminFunctionDetailApi>(
      `/api/v1/admin/functions/${encodeURIComponent(taskType)}`,
    ),
};
