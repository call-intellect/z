/**
 * API-клиент для entity-graph (G.3 KC-Temporal, 2026-05-25).
 *
 * Эндпоинты:
 *   - `GET  /api/v1/knowledge/entities/:id/graph?depth=1..3` — entity-centric
 *     граф с rich-edge атрибутами и top-3 evidence на ребро.
 *   - `POST /api/v1/knowledge/entities/:id/mark-wrong` — пометить ребро или
 *     сущность как «неверную» (попадает в LlmPreferenceSample через
 *     `CurationService.recordDecision({decisionType:'mark_as_misleading'})`).
 *
 * Защита — cookie + TenantGuard. RBAC — entity:read (для GET) и entity:write
 * (для POST). Используется страницей `/entities/[id]/graph`.
 */

import { apiClient } from './api-client';
import { buildQuery, orgHeaders } from './admin-helpers';

// ─────────────────────── Response shapes ────────────────────────────────

export interface EntityGraphNodeApi {
  id: string;
  type: 'entity';
  /** Семантический type сущности (person / client / project / ...). */
  entityType: string;
  name: string;
  depth: number;
}

export interface EntityGraphEvidenceApi {
  blockId: string;
  blockName: string;
  quote: string;
  sourceTimestamp: string | null;
}

export interface EntityGraphEdgeApi {
  edgeId: string;
  from: string;
  to: string;
  relationType: string;
  confidence: number;
  attributes: Record<string, unknown> | null;
  validFrom: string;
  validUntil: string | null;
  evidence: EntityGraphEvidenceApi[];
}

export interface EntityGraphResultApi {
  center: {
    id: string;
    type: 'entity';
    entityType: string;
    name: string;
  };
  nodes: EntityGraphNodeApi[];
  edges: EntityGraphEdgeApi[];
  truncated: boolean;
}

// ─────────────────────── Request shapes ─────────────────────────────────

export interface GetEntityGraphRequestApi {
  /** Глубина обхода: 1..3. По умолчанию — 2. */
  depth?: number;
}

export interface MarkEntityWrongRequestApi {
  /** id ребра (EntityLink.id). Передавать ровно одно: edgeId или nodeId. */
  edgeId?: string;
  /** id узла (Entity.id). */
  nodeId?: string;
  reason?: string;
  taskType?: string;
}

export interface MarkEntityWrongResponseApi {
  ok: true;
  curationItemId: string;
  curationDecisionId: string;
}

// ─────────────────────── Client ─────────────────────────────────────────

export const entitiesGraphApi = {
  /**
   * G.3 — entity-centric граф «что система знает про X».
   *
   * Лимит nodes — 100, evidence per edge — 3 (top по recency).
   * При обрезании по лимиту — `truncated=true`.
   */
  getGraph: (
    orgId: string,
    entityId: string,
    req: GetEntityGraphRequestApi = {},
  ) =>
    apiClient.get<EntityGraphResultApi>(
      `/api/v1/knowledge/entities/${encodeURIComponent(entityId)}/graph${buildQuery({ depth: req.depth })}`,
      { headers: orgHeaders(orgId) },
    ),

  /**
   * G.3 — отметить ребро / узел как «неверный». Передавать ровно один из
   * `edgeId` / `nodeId`. Без них — backend вернёт 400.
   */
  markWrong: (
    orgId: string,
    entityId: string,
    body: MarkEntityWrongRequestApi,
  ) =>
    apiClient.post<MarkEntityWrongResponseApi>(
      `/api/v1/knowledge/entities/${encodeURIComponent(entityId)}/mark-wrong`,
      body,
      { headers: orgHeaders(orgId) },
    ),
};
