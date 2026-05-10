/**
 * API-клиент для Org-Admin knowledge-core debug (Фаза 7).
 *
 * Контракт: `backend/src/modules/admin/controllers/org-admin-knowledge.controller.ts`.
 * Защита — `OrgAdminGuard`.
 */

import { apiClient } from './api-client';
import { buildQuery, orgHeaders } from './admin-helpers';
import type {
  OrgAdminAuditLogListApi,
  OrgAdminLinkKind,
  OrgAdminLinksApi,
  OrgAdminMetricsApi,
  SetWorkersResponse,
} from '@/domain/org-admin-knowledge';

export type ListLinksRequest = {
  kind: OrgAdminLinkKind;
  sortBy?: 'confidence' | 'createdAt';
  minConfidence?: number;
  status?: 'active' | 'archived';
  limit?: number;
};

export type AuditLogsRequest = {
  limit?: number;
  /** CSV-список типов сущностей: `block,entity,theme`. */
  entityTypes?: string;
};

export type BulkDeleteLinksRequest = {
  kind: OrgAdminLinkKind;
  status?: 'active' | 'archived';
  maxConfidence?: number;
  beforeDate?: string;
};

export type MergeEntitiesRequest = { intoEntityId: string };

export type PatchEntityRequest = {
  canonicalName?: string;
  addAlias?: string;
};

export const orgAdminKnowledgeApi = {
  setWorkers: (orgId: string, body: Record<string, boolean>) =>
    apiClient.patch<SetWorkersResponse>(
      '/api/v1/org-admin/knowledge/workers',
      body,
      { headers: orgHeaders(orgId) },
    ),

  getAuditLogs: (orgId: string, req: AuditLogsRequest = {}) =>
    apiClient.get<OrgAdminAuditLogListApi>(
      `/api/v1/org-admin/knowledge/audit-logs${buildQuery({ ...req })}`,
      { headers: orgHeaders(orgId) },
    ),

  listLinks: (orgId: string, req: ListLinksRequest) =>
    apiClient.get<OrgAdminLinksApi>(
      `/api/v1/org-admin/knowledge/links${buildQuery({ ...req })}`,
      { headers: orgHeaders(orgId) },
    ),

  deleteLink: (orgId: string, linkId: string, kind: OrgAdminLinkKind) =>
    apiClient.del<{ ok: true }>(
      `/api/v1/org-admin/knowledge/links/${encodeURIComponent(linkId)}${buildQuery({ kind })}`,
      { headers: orgHeaders(orgId) },
    ),

  bulkDeleteLinks: (
    orgId: string,
    body: BulkDeleteLinksRequest,
    confirm = 'YES',
  ) =>
    apiClient.post<{ ok: true; affected: number }>(
      `/api/v1/org-admin/knowledge/links/bulk-delete${buildQuery({ confirm })}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  mergeEntities: (
    orgId: string,
    fromEntityId: string,
    body: MergeEntitiesRequest,
  ) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/org-admin/knowledge/entities/${encodeURIComponent(fromEntityId)}/merge`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  patchEntity: (orgId: string, entityId: string, body: PatchEntityRequest) =>
    apiClient.patch<{ ok: true }>(
      `/api/v1/org-admin/knowledge/entities/${encodeURIComponent(entityId)}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  reprocessRawEvent: (orgId: string, rawEventId: string) =>
    apiClient.post<{ ok: true; deletedBlocks: number }>(
      `/api/v1/org-admin/knowledge/raw-events/${encodeURIComponent(rawEventId)}/reprocess`,
      undefined,
      { headers: orgHeaders(orgId) },
    ),

  getMetrics: (orgId: string) =>
    apiClient.get<OrgAdminMetricsApi>(
      '/api/v1/org-admin/knowledge/metrics',
      { headers: orgHeaders(orgId) },
    ),
};
