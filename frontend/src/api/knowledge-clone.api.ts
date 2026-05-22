/**
 * SBA β-2 — API-клиент «Профиля знаний» (Knowledge Clone).
 *
 * Эндпоинты:
 *   - GET  /api/v1/me/knowledge-profile
 *   - GET  /api/v1/persons/:id/knowledge-profile
 *   - POST /api/v1/me/knowledge-profile/mark-wrong
 *
 * Защита: `CookieAuthGuard + TenantGuard`. RBAC ресурс — `knowledge_profile`.
 */

import { apiClient } from './api-client';
import { orgHeaders } from './admin-helpers';

export type KnowledgeProfileConfidenceApi = 'low' | 'medium' | 'high';

export interface KnowledgeProfileSampleStatementApi {
  quote: string;
  blockId: string;
  sourceUrl?: string | null;
}

export interface KnowledgeProfileCategoryApi {
  name: string;
  confidence: KnowledgeProfileConfidenceApi;
  observationCount: number;
  sampleStatements: KnowledgeProfileSampleStatementApi[];
  relatedEntityIds: string[];
  lastObservedAt: string;
}

export interface KnowledgeProfileHighlightApi {
  summary: string;
  blockIds: string[];
}

export interface KnowledgeProfileApi {
  personId: string;
  personName: string;
  version: number;
  builtAt: string;
  isEmpty: boolean;
  categories: KnowledgeProfileCategoryApi[];
  experienceHighlights: KnowledgeProfileHighlightApi[];
  isSelf: boolean;
}

export interface MarkWrongRequestApi {
  categoryName: string;
  reason: string;
}

export interface MarkWrongResponseApi {
  ok: true;
  curationItemId: string;
}

export const knowledgeCloneApi = {
  /** Свой профиль (что Кора знает обо мне). */
  getMine: (orgId: string) =>
    apiClient.get<KnowledgeProfileApi>('/api/v1/me/knowledge-profile', {
      headers: orgHeaders(orgId),
    }),

  /** Профиль другого сотрудника. */
  getByPerson: (orgId: string, personId: string) =>
    apiClient.get<KnowledgeProfileApi>(
      `/api/v1/persons/${encodeURIComponent(personId)}/knowledge-profile`,
      {
        headers: orgHeaders(orgId),
      },
    ),

  /** Пометить область знаний в своём профиле как неверную → CurationItem deep review. */
  markWrong: (orgId: string, body: MarkWrongRequestApi) =>
    apiClient.post<MarkWrongResponseApi>(
      '/api/v1/me/knowledge-profile/mark-wrong',
      body,
      { headers: orgHeaders(orgId) },
    ),
};
