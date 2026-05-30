/**
 * API-клиент для страниц персоны (Фаза 11 knowledge-core / 152-ФЗ) и
 * быстрого создания контакта (Calendar MVP Фаза P4, 2026-05-25).
 *
 * Эндпоинты:
 *   - `GET    /api/v1/knowledge/entities/:id`        — данные сущности.
 *   - `DELETE /api/v1/persons/:entityId/data`        — удаление личных данных.
 *   - `POST   /api/v1/persons/quick-create`          — быстрое создание Person
 *     из ParticipantPicker (минимально name+email?+phone?, дубль-защита).
 *
 * Защита: `CookieAuthGuard + TenantGuard`. На стирание — owner-only (RBAC
 * `person.erase`). Чтение — `entity.read`. quick-create — RBAC `event_card.write`.
 */

import { apiClient } from './api-client';
import { buildQuery, orgHeaders } from './admin-helpers';
import type { PersonPulseApi } from '@/domain/person-pulse';

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

export interface QuickCreatePersonRequestApi {
  name: string;
  email?: string;
  phone?: string;
}

export interface QuickCreatePersonResponseApi {
  personId: string;
  name: string;
  email: string | null;
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

  /**
   * Быстро создать внешний контакт (Calendar MVP Фаза P4). Дубль-защита по
   * (tenantId, email) на бэке; без email — по точному совпадению name среди
   * контактов без email.
   *
   * Authorization — cookie + Org из контекста (TenantGuard), отдельный
   * `orgId` не нужен. RBAC — `event_card.write`.
   */
  quickCreate: (body: QuickCreatePersonRequestApi) =>
    apiClient.post<QuickCreatePersonResponseApi>(
      '/api/v1/persons/quick-create',
      body,
    ),

  /**
   * Pulse Wave 3 §3.4 — карточка сотрудника (engagement / mood 30d /
   * promises / HR-suggestions). RBAC backend: owner/admin/coo ИЛИ сам
   * сотрудник.
   */
  getPulse: (orgId: string, personId: string) =>
    apiClient.get<PersonPulseApi>(
      `/api/v1/persons/${encodeURIComponent(personId)}/pulse`,
      { headers: orgHeaders(orgId) },
    ),
};
