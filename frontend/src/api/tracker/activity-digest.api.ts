import { apiClient } from "../api-client";
import { orgHeaders } from "../admin-helpers";

export interface ActivityDigestApi {
  summary: string;
  points: string[];
  hasChanges: boolean;
  since: string | null;
  generatedAt: string;
}

export const activityDigestApi = {
  get: (orgId: string, issueId: string, since?: string) => {
    const query = since ? `?since=${encodeURIComponent(since)}` : "";
    return apiClient.get<ActivityDigestApi>(
      `/api/v1/issues/${encodeURIComponent(issueId)}/activity-digest${query}`,
      { headers: orgHeaders(orgId) },
    );
  },
};
