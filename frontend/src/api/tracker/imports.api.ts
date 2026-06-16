import { apiClient } from "../api-client";
import { buildQuery, orgHeaders } from "../admin-helpers";
import type {
  ImportLogApi,
  ImportSource,
  ImportStatus,
  ListImportLogsResponseApi,
} from "@/domain/tracker";

export type UserMappings = Record<string, string | null>;

export interface StartTrelloImportRequest {
  jsonContent: Record<string, unknown>;
  selectedBoardIds: string[];
  userMappings?: UserMappings;
}

export interface StartBitrix24ImportRequest {
  webhookUrl: string;
  selectedGroupIds: string[];
  userMappings?: UserMappings;
}

export interface StartYandexTrackerImportRequest {
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
      "/api/v1/tracker/imports/trello",
      body,
      { headers: orgHeaders(orgId) },
    ),

  startBitrix24: (orgId: string, body: StartBitrix24ImportRequest) =>
    apiClient.post<StartImportResponse>(
      "/api/v1/tracker/imports/bitrix24",
      body,
      { headers: orgHeaders(orgId) },
    ),

  startYandexTracker: (orgId: string, body: StartYandexTrackerImportRequest) =>
    apiClient.post<StartImportResponse>(
      "/api/v1/tracker/imports/yandex-tracker",
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
