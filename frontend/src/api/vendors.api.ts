/**
 * API-клиент модуля vendors (SBA α-3 — категория A онтологии).
 * Контракт: `backend/src/modules/vendors/`.
 *
 * Эндпоинты:
 *   - GET    /api/v1/vendors?segment=&status=&q=&page=&limit=
 *   - GET    /api/v1/vendors/:id
 *   - POST   /api/v1/vendors                — создание (ТЗ 2026-05-28)
 *   - PATCH  /api/v1/vendors/:id            — частичное обновление
 *   - DELETE /api/v1/vendors/:id            — soft-delete
 *
 * Защита: `CookieAuthGuard + TenantGuard`, RBAC `vendor:read/write/delete`.
 */

import { apiClient } from './api-client';
import { orgHeaders } from './admin-helpers';

export type VendorSegmentApi =
  | 'software'
  | 'hardware'
  | 'consulting'
  | 'logistics'
  | 'other';

export type VendorStatusApi = 'active' | 'evaluating' | 'churned' | 'banned';

export interface VendorListItemApi {
  id: string;
  entityId: string;
  name: string;
  inn: string | null;
  segment: VendorSegmentApi | null;
  status: VendorStatusApi;
  responsibleUserId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface VendorApi extends VendorListItemApi {
  contractIds: string[];
  metadata: Record<string, unknown> | null;
}

export interface VendorsListResponseApi {
  items: VendorListItemApi[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export type ListVendorsRequest = {
  page?: number;
  limit?: number;
  segment?: VendorSegmentApi;
  status?: VendorStatusApi;
  q?: string;
};

function buildVendorsQuery(filters?: ListVendorsRequest): string {
  if (!filters) return '';
  const p = new URLSearchParams();
  if (filters.page) p.set('page', String(filters.page));
  if (filters.limit) p.set('limit', String(filters.limit));
  if (filters.segment) p.set('segment', filters.segment);
  if (filters.status) p.set('status', filters.status);
  if (filters.q) p.set('q', filters.q);
  const qs = p.toString();
  return qs ? `?${qs}` : '';
}

export interface CreateVendorRequest {
  name: string;
  inn?: string | null;
  segment?: VendorSegmentApi | null;
  status?: VendorStatusApi;
  responsibleUserId?: string | null;
}

export interface UpdateVendorRequest {
  name?: string;
  inn?: string | null;
  segment?: VendorSegmentApi | null;
  status?: VendorStatusApi;
  responsibleUserId?: string | null;
}

export const vendorsApi = {
  list: (filters?: ListVendorsRequest, orgId?: string) =>
    apiClient.get<VendorsListResponseApi>(
      `/api/v1/vendors${buildVendorsQuery(filters)}`,
      orgId ? { headers: orgHeaders(orgId) } : undefined,
    ),

  get: (id: string, orgId?: string) =>
    apiClient.get<VendorApi>(
      `/api/v1/vendors/${encodeURIComponent(id)}`,
      orgId ? { headers: orgHeaders(orgId) } : undefined,
    ),

  create: (orgId: string, body: CreateVendorRequest) =>
    apiClient.post<VendorApi>('/api/v1/vendors', body, {
      headers: orgHeaders(orgId),
    }),

  update: (orgId: string, id: string, body: UpdateVendorRequest) =>
    apiClient.patch<VendorApi>(
      `/api/v1/vendors/${encodeURIComponent(id)}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  remove: (orgId: string, id: string) =>
    apiClient.del<void>(`/api/v1/vendors/${encodeURIComponent(id)}`, {
      headers: orgHeaders(orgId),
    }),
};
