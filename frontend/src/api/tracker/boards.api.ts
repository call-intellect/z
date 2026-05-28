/**
 * API-клиент модуля tracker.boards (Tracker Boards, 2026-05-27).
 *
 * Контракт: `backend/src/modules/tracker/controllers/boards.controller.ts`.
 * Auth: `CookieAuthGuard + TenantGuard` (cookie + `X-Org-Id`).
 *
 * ТЗ: plans/tz/2026-05-27-tracker-boards.md.
 */

import type {
  BoardApi,
  ListBoardsResponseApi,
} from '@/domain/tracker';

import { orgHeaders, buildQuery } from '../admin-helpers';
import { apiClient } from '../api-client';

export interface ListBoardsRequest {
  includeArchived?: boolean;
}

export interface CreateBoardRequest {
  name: string;
  color?: string;
  icon?: string | null;
  description?: string | null;
}

export interface UpdateBoardRequest {
  name?: string;
  color?: string;
  icon?: string | null;
  description?: string | null;
  sequence?: number;
}

export interface ReorderBoardsRequest {
  boardIds: string[];
}

export interface DeleteBoardResponse {
  ok: true;
  movedIssuesCount: number;
  movedToBoardId: string;
}

export const boardsApi = {
  list: (orgId: string, projectId: string, req: ListBoardsRequest = {}) =>
    apiClient.get<ListBoardsResponseApi>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/boards${buildQuery({
        ...req,
      })}`,
      { headers: orgHeaders(orgId) },
    ),

  get: (orgId: string, boardId: string) =>
    apiClient.get<BoardApi>(
      `/api/v1/boards/${encodeURIComponent(boardId)}`,
      { headers: orgHeaders(orgId) },
    ),

  create: (orgId: string, projectId: string, body: CreateBoardRequest) =>
    apiClient.post<BoardApi>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/boards`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  update: (orgId: string, boardId: string, body: UpdateBoardRequest) =>
    apiClient.patch<BoardApi>(
      `/api/v1/boards/${encodeURIComponent(boardId)}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  remove: (orgId: string, boardId: string) =>
    apiClient.del<DeleteBoardResponse>(
      `/api/v1/boards/${encodeURIComponent(boardId)}`,
      { headers: orgHeaders(orgId) },
    ),

  archive: (orgId: string, boardId: string) =>
    apiClient.post<BoardApi>(
      `/api/v1/boards/${encodeURIComponent(boardId)}/archive`,
      undefined,
      { headers: orgHeaders(orgId) },
    ),

  unarchive: (orgId: string, boardId: string) =>
    apiClient.post<BoardApi>(
      `/api/v1/boards/${encodeURIComponent(boardId)}/unarchive`,
      undefined,
      { headers: orgHeaders(orgId) },
    ),

  reorder: (orgId: string, body: ReorderBoardsRequest) =>
    apiClient.post<ListBoardsResponseApi>(
      `/api/v1/boards/reorder`,
      body,
      { headers: orgHeaders(orgId) },
    ),
};
