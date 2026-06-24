import { apiClient } from "./api-client";
import { orgHeaders } from "./admin-helpers";

export type CustomerStatusApi = "active" | "inactive" | "churned";

export interface CustomerListItemApi {
  id: string;
  entityId: string;
  name: string;
  inn: string | null;
  email: string | null;
  phone: string | null;
  status: CustomerStatusApi;
  source: string | null;
  externalCrmId: string | null;
  responsiblePersonId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CustomerApi extends CustomerListItemApi {
  metadata: Record<string, unknown> | null;
}

export interface CustomersListResponseApi {
  items: CustomerListItemApi[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export type ListCustomersRequest = {
  page?: number;
  limit?: number;
  status?: CustomerStatusApi;
  q?: string;
};

function buildCustomersQuery(filters?: ListCustomersRequest): string {
  if (!filters) return "";
  const p = new URLSearchParams();
  if (filters.page) p.set("page", String(filters.page));
  if (filters.limit) p.set("limit", String(filters.limit));
  if (filters.status) p.set("status", filters.status);
  if (filters.q) p.set("q", filters.q);
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}

export const customersApi = {
  list: (filters?: ListCustomersRequest, orgId?: string) =>
    apiClient.get<CustomersListResponseApi>(
      `/api/v1/customers${buildCustomersQuery(filters)}`,
      orgId ? { headers: orgHeaders(orgId) } : undefined,
    ),

  get: (id: string, orgId?: string) =>
    apiClient.get<CustomerApi>(
      `/api/v1/customers/${encodeURIComponent(id)}`,
      orgId ? { headers: orgHeaders(orgId) } : undefined,
    ),
};
