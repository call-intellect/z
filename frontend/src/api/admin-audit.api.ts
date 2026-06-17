import { apiClient } from "./api-client";
import { buildQuery } from "./admin-helpers";
import type {
  AdminAuditAdminsListApi,
  AdminAuditListApi,
} from "@/domain/admin-audit";

export type ListAuditRequest = {
  adminUserId?: string;
  tenantId?: string;
  route?: string;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
};

export const adminAuditApi = {
  list: (req: ListAuditRequest) =>
    apiClient.get<AdminAuditListApi>(
      `/api/v1/admin/audit${buildQuery({ ...req })}`,
    ),

  listAdmins: () =>
    apiClient.get<AdminAuditAdminsListApi>("/api/v1/admin/audit/admins"),
};
