import { apiClient } from "./api-client";
import type {
  EntitlementApi,
  PatchEntitlementBody,
} from "@/domain/entitlement";

export const entitlementsApi = {
  getMe: () => apiClient.get<EntitlementApi>("/api/v1/me/entitlements"),

  getBilling: () => apiClient.get<EntitlementApi>("/api/v1/settings/billing"),

  getAdminOrg: (tenantId: string) =>
    apiClient.get<EntitlementApi>(
      `/api/v1/admin/orgs/${encodeURIComponent(tenantId)}/entitlement`,
    ),

  patchAdminOrg: (tenantId: string, patch: PatchEntitlementBody) =>
    apiClient.patch<EntitlementApi>(
      `/api/v1/admin/orgs/${encodeURIComponent(tenantId)}/entitlement`,
      patch,
    ),
};
