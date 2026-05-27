/**
 * API-клиент модуля `tracker.project-documents` (2026-05-27).
 *
 * Контракт:
 *   - `backend/src/modules/tracker/controllers/project-documents.controller.ts`
 *   - `backend/src/modules/tracker/controllers/document-uploads.controller.ts`
 */

import { apiClient } from '../api-client';
import { orgHeaders } from '../admin-helpers';
import type {
  LinkedCardApi,
  ProjectDocumentApi,
  ProjectDocumentSummaryApi,
} from '@/domain/tracker';

export interface CreateProjectDocumentRequest {
  title: string;
  /** TipTap JSON (или произвольный JSON-объект; сервер не валидирует структуру). */
  content?: unknown;
  contentHtml?: string;
  contentStripped?: string;
  parentId?: string | null;
}

export interface UpdateProjectDocumentRequest {
  title?: string;
  content?: unknown;
  contentHtml?: string;
  contentStripped?: string;
  pinned?: boolean;
  parentId?: string | null;
  sortOrder?: number;
}

export interface UploadDocumentAssetResponse {
  /** S3-ключ (для повторного presign / удаления). */
  key: string;
  /** Presigned URL картинки (TTL ~1ч). Подставляется как `src` в `<img>`. */
  url: string;
  expiresAt: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

export const projectDocumentsApi = {
  listByProject: (orgId: string, projectId: string) =>
    apiClient.get<ProjectDocumentSummaryApi[]>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/documents`,
      { headers: orgHeaders(orgId) },
    ),

  byId: (orgId: string, documentId: string) =>
    apiClient.get<ProjectDocumentApi>(
      `/api/v1/project-documents/${encodeURIComponent(documentId)}`,
      { headers: orgHeaders(orgId) },
    ),

  create: (
    orgId: string,
    projectId: string,
    body: CreateProjectDocumentRequest,
  ) =>
    apiClient.post<ProjectDocumentApi>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/documents`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  update: (
    orgId: string,
    documentId: string,
    body: UpdateProjectDocumentRequest,
  ) =>
    apiClient.patch<ProjectDocumentApi>(
      `/api/v1/project-documents/${encodeURIComponent(documentId)}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  remove: (orgId: string, documentId: string) =>
    apiClient.del<void>(
      `/api/v1/project-documents/${encodeURIComponent(documentId)}`,
      { headers: orgHeaders(orgId) },
    ),

  restore: (orgId: string, documentId: string) =>
    apiClient.post<ProjectDocumentApi>(
      `/api/v1/project-documents/${encodeURIComponent(documentId)}/restore`,
      undefined,
      { headers: orgHeaders(orgId) },
    ),

  duplicate: (orgId: string, documentId: string) =>
    apiClient.post<ProjectDocumentApi>(
      `/api/v1/project-documents/${encodeURIComponent(documentId)}/duplicate`,
      undefined,
      { headers: orgHeaders(orgId) },
    ),

  linkedCards: (orgId: string, projectId: string) =>
    apiClient.get<LinkedCardApi[]>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/linked-cards`,
      { headers: orgHeaders(orgId) },
    ),

  /**
   * Загрузить картинку для вставки в редактор (multipart/form-data).
   * Возвращает presigned URL, который вставляется как `<img src=...>` или в
   * TipTap-image node. Идём через нативный fetch — `apiClient.post`
   * сериализует body как JSON.
   */
  uploadAsset: async (
    orgId: string,
    file: File,
  ): Promise<UploadDocumentAssetResponse> => {
    const baseUrl =
      process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(
      `${baseUrl.replace(/\/+$/, '')}/api/v1/uploads/document-asset`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-Org-Id': orgId },
        body: fd,
      },
    );
    if (!res.ok) {
      throw new Error(`Загрузка картинки не удалась: ${res.status}`);
    }
    return (await res.json()) as UploadDocumentAssetResponse;
  },
};
