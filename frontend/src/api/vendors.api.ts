/**
 * API-клиент модуля vendors (SBA α-3 — категория A онтологии).
 * Контракт: `backend/src/modules/vendors/`.
 *
 * Эндпоинты:
 *   - GET /api/v1/vendors?segment=&status=&q=&page=&limit=
 *   - GET /api/v1/vendors/:id
 *
 * Защита: `CookieAuthGuard + TenantGuard`, RBAC `vendor:read`.
 */

import { apiClient } from './api-client';

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

export const vendorsApi = {
  list: (filters?: ListVendorsRequest) =>
    apiClient.get<VendorsListResponseApi>(
      `/api/v1/vendors${buildVendorsQuery(filters)}`,
    ),

  get: (id: string) =>
    apiClient.get<VendorApi>(`/api/v1/vendors/${encodeURIComponent(id)}`),
};
