/**
 * API-клиент модуля tracker.states — справочник IssueState (колонки board).
 *
 * Контракт: `backend/src/modules/tracker/controllers/states.controller.ts`.
 *
 * `GET /api/v1/states` — read-only список IssueState текущей организации,
 * с опциональными фильтрами `projectId` и `category`.
 */

import { apiClient } from '../api-client';
import { buildQuery, orgHeaders } from '../admin-helpers';
import type { IssueStateCategory, ListStatesResponseApi } from '@/domain/tracker';

export interface ListStatesRequest {
  projectId?: string;
  category?: IssueStateCategory;
}

export const statesApi = {
  list: (orgId: string, req: ListStatesRequest = {}) =>
    apiClient.get<ListStatesResponseApi>(
      `/api/v1/states${buildQuery({ ...req })}`,
      { headers: orgHeaders(orgId) },
    ),
};
