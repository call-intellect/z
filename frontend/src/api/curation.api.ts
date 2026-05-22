/**
 * API-клиент Слоя 4 (SBA α-4 — Curation Foundation).
 *
 * Эндпоинты — см. `backend/src/modules/curation/curation.controller.ts`.
 *
 *   GET    /api/v1/curation/queue
 *   GET    /api/v1/curation/items/:id
 *   POST   /api/v1/curation/items/:id/decide
 *   GET    /api/v1/curation/conflicts
 *   GET    /api/v1/curation/conflicts/:id
 *   POST   /api/v1/curation/conflicts/:id/resolve
 *   POST   /api/v1/curation/conflicts/:id/dismiss
 *   GET    /api/v1/settings/curation
 *   PATCH  /api/v1/settings/curation
 */

import { apiClient } from './api-client';

export type CurationLevelApi = 'light' | 'deep';
export type CurationItemStatusApi =
  | 'pending'
  | 'decided'
  | 'expired'
  | 'cancelled';
export type CurationDecisionTypeApi =
  | 'approve'
  | 'reject'
  | 'approve_with_edits'
  | 'split'
  | 'merge'
  | 'supersede';
export type ConflictStatusApi = 'open' | 'resolved' | 'dismissed';
export type ConflictResolutionApi =
  | 'accept_new'
  | 'keep_old'
  | 'merge'
  | 'evolving';

export interface CurationItemApi {
  id: string;
  tenantId: string;
  resourceType: string;
  resourceId: string;
  level: CurationLevelApi;
  triageReason: Record<string, unknown>;
  proposedPayload: Record<string, unknown>;
  status: CurationItemStatusApi;
  assignedToUserId: string | null;
  candidateCuratorIds: string[];
  createdAt: string;
  decidedAt: string | null;
  expiresAt: string | null;
}

export interface CurationDecisionApi {
  id: string;
  curationItemId: string;
  decisionType: CurationDecisionTypeApi;
  payload: Record<string, unknown>;
  reasoning: string | null;
  reviewerUserId: string;
  createdAt: string;
}

export interface CurationItemDetailApi extends CurationItemApi {
  decisions: CurationDecisionApi[];
  relatedConflictIds: string[];
}

export interface ListCurationQueueResponseApi {
  items: CurationItemApi[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ConflictItemApi {
  id: string;
  tenantId: string;
  resourceType: string;
  existingId: string;
  newId: string;
  evidence: Record<string, unknown>;
  relationType: string;
  detectedBy: string;
  status: ConflictStatusApi;
  resolution: ConflictResolutionApi | null;
  evolvingMeta: Record<string, unknown> | null;
  resolvedByUserId: string | null;
  resolvedAt: string | null;
  reasoning: string | null;
  createdAt: string;
}

export interface ListConflictsResponseApi {
  items: ConflictItemApi[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CurationSettingsApi {
  autoThreshold: number;
  deepReviewThreshold: number;
  criticalTypes: string[];
  itemExpiryDays: number;
}

export type ListCurationQueueRequest = {
  level?: CurationLevelApi;
  status?: CurationItemStatusApi;
  resourceType?: string;
  resourceId?: string;
  assignedToMe?: boolean;
  page?: number;
  limit?: number;
};

export type ListConflictsRequest = {
  status?: ConflictStatusApi;
  resourceType?: string;
  page?: number;
  limit?: number;
};

export interface DecideCurationRequest {
  decisionType: CurationDecisionTypeApi;
  payload?: Record<string, unknown>;
  reasoning?: string;
}

export interface ResolveConflictRequest {
  resolution: ConflictResolutionApi;
  evolvingMeta?: {
    existingValidUntil: string;
    newValidFrom: string;
  };
  reasoning?: string;
}

function buildQuery(filters: Record<string, unknown> | undefined): string {
  if (!filters) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null || v === '') continue;
    if (typeof v === 'boolean') {
      p.set(k, v ? 'true' : 'false');
      continue;
    }
    p.set(k, String(v));
  }
  const qs = p.toString();
  return qs ? `?${qs}` : '';
}

export const curationApi = {
  // ── queue ────────────────────────────────────────────────────────
  listQueue: (filters?: ListCurationQueueRequest) =>
    apiClient.get<ListCurationQueueResponseApi>(
      `/api/v1/curation/queue${buildQuery(filters)}`,
    ),

  getItem: (id: string) =>
    apiClient.get<CurationItemDetailApi>(
      `/api/v1/curation/items/${encodeURIComponent(id)}`,
    ),

  decide: (id: string, body: DecideCurationRequest) =>
    apiClient.post<CurationItemApi>(
      `/api/v1/curation/items/${encodeURIComponent(id)}/decide`,
      body,
    ),

  // ── conflicts ────────────────────────────────────────────────────
  listConflicts: (filters?: ListConflictsRequest) =>
    apiClient.get<ListConflictsResponseApi>(
      `/api/v1/curation/conflicts${buildQuery(filters)}`,
    ),

  getConflict: (id: string) =>
    apiClient.get<ConflictItemApi>(
      `/api/v1/curation/conflicts/${encodeURIComponent(id)}`,
    ),

  resolveConflict: (id: string, body: ResolveConflictRequest) =>
    apiClient.post<ConflictItemApi>(
      `/api/v1/curation/conflicts/${encodeURIComponent(id)}/resolve`,
      body,
    ),

  dismissConflict: (id: string, reasoning?: string) =>
    apiClient.post<ConflictItemApi>(
      `/api/v1/curation/conflicts/${encodeURIComponent(id)}/dismiss`,
      reasoning ? { reasoning } : {},
    ),

  // ── settings ─────────────────────────────────────────────────────
  getSettings: () =>
    apiClient.get<CurationSettingsApi>('/api/v1/settings/curation'),

  updateSettings: (body: Partial<CurationSettingsApi>) =>
    apiClient.patch<CurationSettingsApi>('/api/v1/settings/curation', body),
};
