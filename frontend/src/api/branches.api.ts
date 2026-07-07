import { apiClient } from "./api-client";
import type { BranchDetailApi, BranchesMapApi } from "@/domain/branch";

export const branchesApi = {
  map: () => apiClient.get<BranchesMapApi>("/api/v1/knowledge/branches"),
  detail: (branch: string) =>
    apiClient.get<BranchDetailApi>(
      `/api/v1/knowledge/branches/${encodeURIComponent(branch)}`,
    ),
};
