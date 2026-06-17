import { apiClient } from "./api-client";
import { orgHeaders } from "./admin-helpers";
import type {
  OrgRetentionPolicyApi,
  UpdateRetentionPolicyRequest,
} from "@/domain/retention";

export const retentionApi = {
  get: (orgId: string) =>
    apiClient.get<OrgRetentionPolicyApi>("/api/v1/settings/retention", {
      headers: orgHeaders(orgId),
    }),

  update: (orgId: string, body: UpdateRetentionPolicyRequest) =>
    apiClient.patch<OrgRetentionPolicyApi>("/api/v1/settings/retention", body, {
      headers: orgHeaders(orgId),
    }),
};
