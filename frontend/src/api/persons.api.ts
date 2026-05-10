/**
 * API-клиент для страниц персоны (Фаза 11 knowledge-core / 152-ФЗ).
 *
 * Эндпоинты:
 *   - `GET    /api/v1/knowledge/entities/:id`        — данные сущности.
 *   - `DELETE /api/v1/persons/:entityId/data`        — удаление личных данных.
 *
 * Защита: `CookieAuthGuard + TenantGuard`. На стирание — owner-only (RBAC
 * `person.erase`). Чтение — `entity.read`.
 */

import { apiClient } from './api-client';
import { buildQuery, orgHeaders } from './admin-helpers';

export interface PersonEntityApi {
  id: string;
  type: string;
  canonicalName: string;
  aliases: string[];
  mentionsCount: number;
  metadata: Record<string, unknown> | null;
}

export interface PersonBlockApi {
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
}

export interface PersonDetailApi {
  entity: PersonEntityApi;
  blocks: PersonBlockApi[];
  mergedIntoId?: string;
}

export interface EraseReportApi {
  erasedRawEvents: number;
  deletedEvidences: number;
  archivedBlocks: number;
  deletedEntityLinks: number;
  alreadyErased?: boolean;
}

export interface ListPersonsResultApi {
  items: PersonEntityApi[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListPersonsRequest {
  q?: string;
  limit?: number;
  offset?: number;
}

export const personsApi = {
  /**
   * Список персон (фильтр type=person). Под капотом — `/knowledge/entities`.
   */
  list: (orgId: string, req: ListPersonsRequest = {}) =>
    apiClient.get<ListPersonsResultApi>(
      `/api/v1/knowledge/entities${buildQuery({ type: 'person', ...req })}`,
      { headers: orgHeaders(orgId) },
    ),

  /**
   * Деталь сущности (используется и для type='person', и для других — UI
   * сам решает, что показывать). Под капотом — `/knowledge/entities/:id`.
   */
  getEntity: (orgId: string, entityId: string) =>
    apiClient.get<PersonDetailApi>(
      `/api/v1/knowledge/entities/${encodeURIComponent(entityId)}`,
      { headers: orgHeaders(orgId) },
    ),

  /**
   * Удалить все личные данные о персоне (152-ФЗ). Owner-only, идемпотентно.
   * Backend каскадно стирает RawEvent / evidence / IdeaBlockEntity, обезличивает
   * саму Entity, удаляет EntityLink (in/out). См.
   * `backend/src/modules/security/personal-data-deletion.service.ts`.
   */
  eraseData: (orgId: string, entityId: string, reason: string) =>
    apiClient.del<EraseReportApi>(
      `/api/v1/persons/${encodeURIComponent(entityId)}/data`,
      {
        headers: orgHeaders(orgId),
        body: { reason },
      },
    ),
};
