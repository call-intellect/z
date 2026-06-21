import { orgHeaders } from "./admin-helpers";
import { apiClient } from "./api-client";

export type DashboardLayoutApi = {
  role: string;
  rhythm: string;
  layout: string[] | null;
};

export const dashboardLayoutApi = {
  getLayout: (orgId: string, role: string, rhythm: string) =>
    apiClient.get<DashboardLayoutApi>(
      `/api/v1/dashboard/layout?role=${encodeURIComponent(
        role,
      )}&rhythm=${encodeURIComponent(rhythm)}`,
      { headers: orgHeaders(orgId) },
    ),
};
