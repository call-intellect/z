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

/**
 * Метка доверия карточки знаний (Фаза C1). Контракт совпадает с backend
 * `TrustTierDto` и frontend `TrustBadge`. Несут только критические карточки
 * (process / decision / regulation / policy); metric / tool — без неё.
 */
export type DocumentTrustTierApi = 'auto' | 'provisional' | 'human';

export interface DocumentEntityApi {
  id: string;
  kind: DocumentEntityKindApi;
  name: string;
  confidence: number;
  /** Только для process / decision / regulation / policy. */
  trustTier?: DocumentTrustTierApi;
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

/**
 * RAW-форма ответа backend `GET /api/v1/documents/:id` (то, что реально
 * приходит по сети). Backend отдаёт извлечённые карточки в `extractedEntities`
 * как именованные секции, а не как готовый `entityGroups[]`. Трансформацию
 * в UI-модель (`DocumentDetailApi.entityGroups`) делает `buildEntityGroups`.
 *
 * NB: у decisions поле называется `text` (а не `name`); metric / tool
 * приходят без `trustTier`. Доп. поля backend (category / severity / unit /
 * kind) здесь не объявлены — они не нужны UI-модели, а structural typing
 * TS допускает лишние поля в фактическом ответе.
 */
interface DocumentExtractedEntitiesRawApi {
  processes: Array<{ id: string; name: string; confidence: number | null; trustTier: DocumentTrustTierApi }>;
  decisions: Array<{ id: string; text: string; confidence: number | null; trustTier: DocumentTrustTierApi }>;
  regulations: Array<{ id: string; name: string; confidence: number | null; trustTier: DocumentTrustTierApi }>;
  policies: Array<{ id: string; name: string; confidence: number | null; trustTier: DocumentTrustTierApi }>;
  metrics: Array<{ id: string; name: string; confidence: number | null }>;
  tools: Array<{ id: string; name: string; confidence: number | null }>;
}

interface DocumentDetailRawApi {
  document: DocumentApi;
  parsedText: string | null;
  ideaBlocks: DocumentIdeaBlockApi[];
  extractedEntities?: DocumentExtractedEntitiesRawApi;
}

/**
 * Трансформирует RAW-секции `extractedEntities` в UI-модель `entityGroups[]`.
 *
 * - Пустые группы НЕ включаются: так `entityGroups.length === 0` сохраняет
 *   смысл «ничего не извлечено».
 * - `name`: для decisions берётся из `text`, для остальных — из `name`.
 * - `confidence`: `null` → `0`.
 * - `trustTier`: только для критических карточек (process / decision /
 *   regulation / policy); для metric / tool остаётся `undefined`.
 *
 * Exported только ради unit-теста.
 */
export function buildEntityGroups(
  ex?: DocumentExtractedEntitiesRawApi,
): DocumentEntitiesGroupApi[] {
  if (!ex) return [];

  const groups: DocumentEntitiesGroupApi[] = [];

  if (ex.processes.length > 0) {
    groups.push({
      kind: 'process',
      total: ex.processes.length,
      items: ex.processes.map((e) => ({
        id: e.id,
        kind: 'process',
        name: e.name,
        confidence: e.confidence ?? 0,
        trustTier: e.trustTier,
      })),
    });
  }

  if (ex.decisions.length > 0) {
    groups.push({
      kind: 'decision',
      total: ex.decisions.length,
      items: ex.decisions.map((e) => ({
        id: e.id,
        kind: 'decision',
        name: e.text,
        confidence: e.confidence ?? 0,
        trustTier: e.trustTier,
      })),
    });
  }

  if (ex.regulations.length > 0) {
    groups.push({
      kind: 'regulation',
      total: ex.regulations.length,
      items: ex.regulations.map((e) => ({
        id: e.id,
        kind: 'regulation',
        name: e.name,
        confidence: e.confidence ?? 0,
        trustTier: e.trustTier,
      })),
    });
  }

  if (ex.policies.length > 0) {
    groups.push({
      kind: 'policy',
      total: ex.policies.length,
      items: ex.policies.map((e) => ({
        id: e.id,
        kind: 'policy',
        name: e.name,
        confidence: e.confidence ?? 0,
        trustTier: e.trustTier,
      })),
    });
  }

  if (ex.metrics.length > 0) {
    groups.push({
      kind: 'metric',
      total: ex.metrics.length,
      items: ex.metrics.map((e) => ({
        id: e.id,
        kind: 'metric',
        name: e.name,
        confidence: e.confidence ?? 0,
      })),
    });
  }

  if (ex.tools.length > 0) {
    groups.push({
      kind: 'tool',
      total: ex.tools.length,
      items: ex.tools.map((e) => ({
        id: e.id,
        kind: 'tool',
        name: e.name,
        confidence: e.confidence ?? 0,
      })),
    });
  }

  return groups;
}

export const documentsApi = {
  list: (orgId: string, query: ListDocumentsQuery = {}) =>
    apiClient.get<ListDocumentsResponseApi>(
      `/api/v1/documents${buildQuery({ ...query })}`,
      { headers: orgHeaders(orgId) },
    ),

  byId: async (orgId: string, id: string): Promise<DocumentDetailApi> => {
    const raw = await apiClient.get<DocumentDetailRawApi>(
      `/api/v1/documents/${encodeURIComponent(id)}`,
      { headers: orgHeaders(orgId) },
    );
    return {
      document: raw.document,
      parsedText: raw.parsedText,
      ideaBlocks: raw.ideaBlocks,
      entityGroups: buildEntityGroups(raw.extractedEntities),
    };
  },

  remove: (orgId: string, id: string) =>
    apiClient.del<{ ok: true }>(
      `/api/v1/documents/${encodeURIComponent(id)}`,
      { headers: orgHeaders(orgId) },
    ),

  upload: uploadDocumentMultipart,
};
