/**
 * API-клиент модуля tracker.imports (Wave 3 / Tracker Phase 5 part 1).
 *
 * Backend контракт: `backend/src/modules/tracker/controllers/imports.controller.ts`.
 * Auth: `CookieAuthGuard + TenantGuard` (cookie + `X-Org-Id` header).
 * RBAC: `import_tracker` — read для list/byId, write для start/cancel.
 *
 * Источники:
 *   - `trello` — реальная реализация (JSON-export).
 *   - `bitrix24` — заглушка (worker сразу NotImplemented).
 *   - `yandex_tracker` — заглушка.
 */

import { apiClient } from '../api-client';
import { buildQuery, orgHeaders } from '../admin-helpers';
import type {
  ImportLogApi,
  ImportSource,
  ImportStatus,
  ListImportLogsResponseApi,
} from '@/domain/tracker';

/**
 * Mapping email пользователя источника → ID нашего пользователя.
 *   - значение string → email замаплен, assignee создастся;
 *   - значение null → пользователь явно пропущен (assignee НЕ создаётся);
 *   - email отсутствует в record → unmatched (попадёт в ImportLog.unmatchedJson).
 */
export type UserMappings = Record<string, string | null>;

export interface StartTrelloImportRequest {
  /** JSON-export Trello (целиком, как файл от пользователя). */
  jsonContent: Record<string, unknown>;
  /** Какие board'ы импортировать (id из jsonContent). */
  selectedBoardIds: string[];
  /** Email → ourUserId или null. */
  userMappings?: UserMappings;
}

export interface StartBitrix24ImportRequest {
  /** Входящий webhook URL Битрикс24 (https://your-portal.bitrix24.ru/rest/N/TOKEN/). */
  webhookUrl: string;
  selectedGroupIds: string[];
  userMappings?: UserMappings;
}

export interface StartYandexTrackerImportRequest {
  /** OAuth-токен Яндекс ID для доступа к API Я.Трекера. */
  oauthToken: string;
  selectedQueueIds: string[];
  userMappings?: UserMappings;
}

export interface ListImportsRequest {
  limit?: number;
  cursor?: string;
  source?: ImportSource;
  status?: ImportStatus;
}

export interface StartImportResponse {
  importLogId: string;
}

export const importsApi = {
  startTrello: (orgId: string, body: StartTrelloImportRequest) =>
    apiClient.post<StartImportResponse>(
      '/api/v1/tracker/imports/trello',
      body,
      { headers: orgHeaders(orgId) },
    ),

  startBitrix24: (orgId: string, body: StartBitrix24ImportRequest) =>
    apiClient.post<StartImportResponse>(
      '/api/v1/tracker/imports/bitrix24',
      body,
      { headers: orgHeaders(orgId) },
    ),

  startYandexTracker: (orgId: string, body: StartYandexTrackerImportRequest) =>
    apiClient.post<StartImportResponse>(
      '/api/v1/tracker/imports/yandex-tracker',
      body,
      { headers: orgHeaders(orgId) },
    ),

  list: (orgId: string, req: ListImportsRequest = {}) =>
    apiClient.get<ListImportLogsResponseApi>(
      `/api/v1/tracker/imports${buildQuery({ ...req })}`,
      { headers: orgHeaders(orgId) },
    ),

  getById: (orgId: string, importLogId: string) =>
    apiClient.get<ImportLogApi>(
      `/api/v1/tracker/imports/${encodeURIComponent(importLogId)}`,
      { headers: orgHeaders(orgId) },
    ),

  cancel: (orgId: string, importLogId: string) =>
    apiClient.post<ImportLogApi>(
      `/api/v1/tracker/imports/${encodeURIComponent(importLogId)}/cancel`,
      undefined,
      { headers: orgHeaders(orgId) },
    ),
};
