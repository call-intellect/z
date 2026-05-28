/**
 * API-клиент модуля tracker.checklists (2026-05-27).
 *
 * Контракт: `backend/src/modules/tracker/controllers/checklists.controller.ts`.
 */

import { apiClient } from '../api-client';
import { orgHeaders } from '../admin-helpers';
import type { ChecklistApi, ChecklistItemApi } from '@/domain/tracker';

export interface CreateChecklistRequest {
  title?: string;
}

export interface UpdateChecklistRequest {
  title?: string;
}

export interface ReorderChecklistsRequest {
  issueId: string;
  checklistIds: string[];
}

export interface CreateChecklistItemRequest {
  text: string;
}

export interface UpdateChecklistItemRequest {
  text?: string;
  isDone?: boolean;
  sequence?: number;
}

export interface ReorderChecklistItemsRequest {
  checklistId: string;
  itemIds: string[];
}

export interface BulkCreateChecklistItemsRequest {
  checklistId: string;
  lines: string[];
}

export const checklistsApi = {
  listByIssue: (orgId: string, issueId: string) =>
    apiClient.get<ChecklistApi[]>(
      `/api/v1/issues/${encodeURIComponent(issueId)}/checklists`,
      { headers: orgHeaders(orgId) },
    ),

  createChecklist: (
    orgId: string,
    issueId: string,
    body: CreateChecklistRequest,
  ) =>
    apiClient.post<ChecklistApi>(
      `/api/v1/issues/${encodeURIComponent(issueId)}/checklists`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  updateChecklist: (
    orgId: string,
    checklistId: string,
    body: UpdateChecklistRequest,
  ) =>
    apiClient.patch<ChecklistApi>(
      `/api/v1/checklists/${encodeURIComponent(checklistId)}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  deleteChecklist: (orgId: string, checklistId: string) =>
    apiClient.del<void>(
      `/api/v1/checklists/${encodeURIComponent(checklistId)}`,
      { headers: orgHeaders(orgId) },
    ),

  reorderChecklists: (orgId: string, body: ReorderChecklistsRequest) =>
    apiClient.post<ChecklistApi[]>(`/api/v1/checklists/reorder`, body, {
      headers: orgHeaders(orgId),
    }),

  createItem: (
    orgId: string,
    checklistId: string,
    body: CreateChecklistItemRequest,
  ) =>
    apiClient.post<ChecklistItemApi>(
      `/api/v1/checklists/${encodeURIComponent(checklistId)}/items`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  updateItem: (
    orgId: string,
    itemId: string,
    body: UpdateChecklistItemRequest,
  ) =>
    apiClient.patch<ChecklistItemApi>(
      `/api/v1/checklist-items/${encodeURIComponent(itemId)}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  deleteItem: (orgId: string, itemId: string) =>
    apiClient.del<void>(
      `/api/v1/checklist-items/${encodeURIComponent(itemId)}`,
      { headers: orgHeaders(orgId) },
    ),

  reorderItems: (orgId: string, body: ReorderChecklistItemsRequest) =>
    apiClient.post<ChecklistItemApi[]>(
      `/api/v1/checklist-items/reorder`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  bulkCreateItems: (orgId: string, body: BulkCreateChecklistItemsRequest) =>
    apiClient.post<ChecklistItemApi[]>(
      `/api/v1/checklist-items/bulk-create`,
      body,
      { headers: orgHeaders(orgId) },
    ),
};
