/**
 * SBA α-9 wave 3 — API-клиент для /api/v1/domains.
 */

import { apiClient } from './api-client';
import { buildQuery, orgHeaders } from './admin-helpers';

export interface FunctionalDomainApi {
  id: string;
  tenantId: string;
  parentDomainId: string | null;
  name: string;
  slug: string;
  description: string | null;
  iconName: string | null;
  isSystem: boolean;
  completeness: number | null;
  order: number;
  confidence: number | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  children?: FunctionalDomainApi[];
  linkedDepartmentsCount?: number;
}

export interface ListDomainsResponseApi {
  items: FunctionalDomainApi[];
  total: number;
}

export interface ListDomainsQuery {
  includeChildren?: boolean;
  onlySystem?: boolean;
  includeDeleted?: boolean;
  limit?: number;
}

export interface CreateDomainRequest {
  name: string;
  slug: string;
  description?: string | null;
  iconName?: string | null;
  parentDomainId?: string | null;
  order?: number;
}

export interface UpdateDomainRequest {
  name?: string;
  description?: string | null;
  iconName?: string | null;
  parentDomainId?: string | null;
  order?: number;
}

export type IndustrySlugApi =
  | 'saas'
  | 'developer'
  | 'retail'
  | 'manufacturing'
  | 'b2b_services';

export interface SeedTemplateResponseApi {
  created: number;
  skipped: number;
  industry: string;
}

export const functionalDomainsApi = {
  list: (orgId: string, query: ListDomainsQuery = {}) =>
    apiClient.get<ListDomainsResponseApi>(
      `/api/v1/domains${buildQuery({ ...query })}`,
      { headers: orgHeaders(orgId) },
    ),

  byId: (orgId: string, id: string) =>
    apiClient.get<FunctionalDomainApi>(
      `/api/v1/domains/${encodeURIComponent(id)}`,
      { headers: orgHeaders(orgId) },
    ),

  create: (orgId: string, body: CreateDomainRequest) =>
    apiClient.post<FunctionalDomainApi>('/api/v1/domains', body, {
      headers: orgHeaders(orgId),
    }),

  update: (orgId: string, id: string, body: UpdateDomainRequest) =>
    apiClient.patch<FunctionalDomainApi>(
      `/api/v1/domains/${encodeURIComponent(id)}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  remove: (orgId: string, id: string) =>
    apiClient.del<{ id: string; deletedAt: string }>(
      `/api/v1/domains/${encodeURIComponent(id)}`,
      { headers: orgHeaders(orgId) },
    ),

  seedTemplate: (orgId: string, industry: IndustrySlugApi) =>
    apiClient.post<SeedTemplateResponseApi>(
      '/api/v1/domains/seed-template',
      { industry },
      { headers: orgHeaders(orgId) },
    ),
};

// ─── Department-domain links ──────────────────────────────────────

export interface DepartmentDomainLinkApi {
  id: string;
  tenantId: string;
  departmentId: string;
  domainId: string;
  role: string;
  coverageRatio: number | null;
  createdAt: string;
  updatedAt: string;
  domain?: {
    id: string;
    name: string;
    slug: string;
    iconName: string | null;
  };
}

export interface LinkDepartmentDomainRequest {
  domainId: string;
  role?: 'primary' | 'secondary' | 'supporting';
  coverageRatio?: number;
}

export const departmentDomainLinksApi = {
  listForDepartment: (orgId: string, departmentId: string) =>
    apiClient.get<{ items: DepartmentDomainLinkApi[] }>(
      `/api/v1/departments/${encodeURIComponent(departmentId)}/domains`,
      { headers: orgHeaders(orgId) },
    ),

  link: (
    orgId: string,
    departmentId: string,
    body: LinkDepartmentDomainRequest,
  ) =>
    apiClient.post<DepartmentDomainLinkApi>(
      `/api/v1/departments/${encodeURIComponent(departmentId)}/link-domain`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  unlink: (orgId: string, departmentId: string, domainId: string) =>
    apiClient.del<{ ok: true }>(
      `/api/v1/departments/${encodeURIComponent(departmentId)}/domains/${encodeURIComponent(domainId)}`,
      { headers: orgHeaders(orgId) },
    ),
};
