import { apiClient } from "./api-client";
import type { PlanSnapshotApi } from "@/domain/admin-plan";

export const adminPlansApi = {
  getCurrent: () =>
    apiClient.get<PlanSnapshotApi>("/api/v1/admin/orgs/plans/current"),
};
