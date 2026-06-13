/**
 * API-клиент гибридного поиска по памяти компании (knowledge-core).
 *
 * Контракт: `POST /api/v1/knowledge/search`
 * (`backend/src/modules/knowledge-core/api/search.controller.ts`,
 * DTO — `.../api/dto/search.dto.ts`). Под `CookieAuthGuard + TenantGuard` —
 * обязателен `X-Org-Id` (через `orgHeaders`). RBAC: `block` `read`.
 *
 * Префикс `knowledge/` отделяет от глобального `/api/v1/search`
 * (`search.api.ts` — cards/meetings/tasks). Это РАЗНЫЕ эндпоинты.
 */

import { apiClient } from './api-client';
import { orgHeaders } from './admin-helpers';

// ─────────────────── ApiDto (зеркало backend search.dto.ts) ───────────────────

export type KnowledgeSearchRequest = {
  /** Непустая строка 1..500 символов (embed + BM25). */
  query: string;
  /** Фильтр по типу сигнала (SignalType). */
  signalTypes?: string[];
  /** Фильтр — блок упоминает хотя бы одну из переданных Entity. */
  entityIds?: string[];
  /** Фильтр по времени источника (ISO). */
  dateFrom?: string;
  dateTo?: string;
  /** 1..50, default 10 на backend. */
  limit?: number;
};

export type KnowledgeBlockApi = {
  id: string;
  name: string;
  criticalQuestion: string;
  trustedAnswer: string;
  signalType: string;
  tags: string[];
  confidence: number;
  evidenceCount: number;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeEvidenceApi = {
  id: string;
  rawEventId: string;
  sourceType: string;
  sourceTimestamp: string | null;
  quote: string;
  startMs: number | null;
  endMs: number | null;
};

export type KnowledgeEntityApi = {
  id: string;
  type: string;
  canonicalName: string;
  aliases: string[];
  mentionsCount: number;
  metadata: Record<string, unknown> | null;
};

export type KnowledgeSearchResultItemApi = {
  block: KnowledgeBlockApi;
  evidence: KnowledgeEvidenceApi[];
  entities: KnowledgeEntityApi[];
  scores: {
    cosine: number;
    bm25: number;
    combined: number;
  };
};

export type KnowledgeSearchResponseApi = {
  results: KnowledgeSearchResultItemApi[];
  tookMs: number;
};

export const knowledgeSearchApi = {
  search: (orgId: string, body: KnowledgeSearchRequest) =>
    apiClient.post<KnowledgeSearchResponseApi>(
      '/api/v1/knowledge/search',
      body,
      { headers: orgHeaders(orgId) },
    ),
};
