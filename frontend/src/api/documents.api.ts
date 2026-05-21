/**
 * API-клиент для модуля documents (Фаза 0c / sub-TZ 0b).
 *
 * Backend контракт — `backend/src/modules/documents/`:
 *   - `GET    /api/v1/documents`           — список (фильтры: uploaderId, roleId, status)
 *   - `POST   /api/v1/documents`           — multipart upload (file + опц. attachedRoleId)
 *   - `GET    /api/v1/documents/:id`       — деталь (parsedText + extracted)
 *   - `DELETE /api/v1/documents/:id`       — удалить
 *
 * Статусы парсинга: uploaded → parsing → parsed | failed.
 */

import { apiClient } from './api-client';
import { ApiError } from './api-error';
import { buildQuery, orgHeaders } from './admin-helpers';

export type DocumentStatusApi =
  | 'uploaded'
  | 'parsing'
  | 'parsed'
  | 'failed';

export type DocumentKindApi =
  | 'job_description'
  | 'regulation'
  | 'policy'
  | 'process'
  | 'metric'
  | 'other';

export interface DocumentApi {
  id: string;
  orgId: string;
  name: string;
  kind: DocumentKindApi;
  mimeType: string | null;
  sizeBytes: number | null;
  status: DocumentStatusApi;
  uploaderId: string | null;
  uploaderName: string | null;
  attachedRoleId: string | null;
  attachedRoleName: string | null;
  createdAt: string;
  parsedAt: string | null;
}

export interface ListDocumentsResponseApi {
  items: DocumentApi[];
  total?: number;
}

export interface ListDocumentsQuery {
  uploaderId?: string;
  roleId?: string;
  status?: DocumentStatusApi;
  limit?: number;
}

export interface DocumentIdeaBlockApi {
  id: string;
  title: string;
  excerpt: string;
  confidence?: number;
}

export type DocumentEntityKindApi =
  | 'process'
  | 'decision'
  | 'regulation'
  | 'policy'
  | 'metric'
  | 'tool';

export interface DocumentEntityApi {
  id: string;
  kind: DocumentEntityKindApi;
  name: string;
  confidence: number;
}

export interface DocumentEntitiesGroupApi {
  kind: DocumentEntityKindApi;
  total: number;
  items: DocumentEntityApi[];
}

export interface DocumentDetailApi {
  document: DocumentApi;
  parsedText: string | null;
  ideaBlocks: DocumentIdeaBlockApi[];
  entityGroups: DocumentEntitiesGroupApi[];
}

export interface UploadDocumentArgs {
  file: File;
  attachedRoleId?: string | null;
}

/**
 * Универсальный «пользовательский» upload: multipart. Не идём через apiClient
 * (он JSON-only), но соблюдаем те же headers (X-Org-Id) и cookie-сессию.
 */
async function uploadDocumentMultipart(
  orgId: string,
  args: UploadDocumentArgs,
): Promise<{ document: DocumentApi }> {
  const baseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
  const url = `${baseUrl.replace(/\/+$/, '')}/api/v1/documents`;
  const form = new FormData();
  form.append('file', args.file);
  if (args.attachedRoleId) {
    form.append('attachedRoleId', args.attachedRoleId);
  }

  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-Org-Id': orgId },
    body: form,
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    let code = `http_${res.status}`;
    try {
      const body = (await res.json()) as {
        error?: { code?: string; message?: string };
      };
      if (body?.error?.message) message = body.error.message;
      if (body?.error?.code) code = body.error.code;
    } catch {
      // ignore
    }
    throw new ApiError({ code, message });
  }
  return (await res.json()) as { document: DocumentApi };
}

export const documentsApi = {
  list: (orgId: string, query: ListDocumentsQuery = {}) =>
    apiClient.get<ListDocumentsResponseApi>(
      `/api/v1/documents${buildQuery({ ...query })}`,
      { headers: orgHeaders(orgId) },
    ),

  byId: (orgId: string, id: string) =>
    apiClient.get<DocumentDetailApi>(
      `/api/v1/documents/${encodeURIComponent(id)}`,
      { headers: orgHeaders(orgId) },
    ),

  remove: (orgId: string, id: string) =>
    apiClient.del<{ ok: true }>(
      `/api/v1/documents/${encodeURIComponent(id)}`,
      { headers: orgHeaders(orgId) },
    ),

  upload: uploadDocumentMultipart,
};
