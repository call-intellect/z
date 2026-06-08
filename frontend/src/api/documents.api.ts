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

/**
 * `DocumentKind` (формат файла) — что это за файл по расширению. Совпадает с
 * Prisma-enum `DocumentKind` (`backend/prisma/schema.prisma`). НЕ путать со
 * смысловым типом документа `DocumentTypeApi` (что это по сути).
 */
export type DocumentKindApi =
  | 'pdf'
  | 'docx'
  | 'markdown'
  | 'text'
  | 'xlsx'
  | 'pptx'
  | 'html'
  | 'rtf'
  | 'odt'
  | 'csv'
  | 'other';

/**
 * `DocumentType` (смысл документа) — чем документ является по сути (регламент,
 * политика и т.п.). Совпадает с Prisma-enum `DocumentType`. Опционален: задаётся
 * вручную при загрузке либо предлагается классификатором (ТЗ-4 Ф10).
 */
export type DocumentTypeApi =
  | 'regulation'
  | 'policy'
  | 'instruction'
  | 'process'
  | 'job_description'
  | 'other';

export interface DocumentApi {
  id: string;
  orgId: string;
  name: string;
  /** Формат файла (pdf/docx/…). */
  kind: DocumentKindApi;
  /** Смысловой тип документа (регламент/политика/…). Может отсутствовать. */
  docType: DocumentTypeApi | null;
  mimeType: string | null;
  sizeBytes: number | null;
  status: DocumentStatusApi;
  uploaderId: string | null;
  uploaderName: string | null;
  attachedRoleId: string | null;
  attachedRoleName: string | null;
  /** Привязка к теме графа (ТЗ-4 Ф3). Может отсутствовать. */
  attachedThemeId: string | null;
  /** Привязка к проекту трекера (ТЗ-4 Ф3). Может отсутствовать. */
  attachedProjectId: string | null;
  createdAt: string;
  parsedAt: string | null;
}

/** Расширения файлов, которые принимает загрузка документов (ТЗ-4 Ф5).
 *  Единственный источник правды для `<input accept>` (Bug-2). Без `.doc` —
 *  это бинарный legacy-формат, который наш парсер не разбирает. */
export const ACCEPTED_DOCUMENT_EXTENSIONS = [
  '.pdf',
  '.docx',
  '.xlsx',
  '.pptx',
  '.md',
  '.txt',
  '.html',
  '.htm',
  '.rtf',
  '.odt',
  '.csv',
] as const;

/** Готовая строка для атрибута `accept` (`<input type="file">`). */
export const ACCEPTED_DOCUMENT_ACCEPT = ACCEPTED_DOCUMENT_EXTENSIONS.join(',');

/** RU-метка ФОРМАТА файла (`DocumentKind`). Bug-1: формат, не смысл. */
export function documentKindLabel(kind: DocumentKindApi): string {
  switch (kind) {
    case 'pdf':
      return 'PDF';
    case 'docx':
      return 'Word';
    case 'markdown':
      return 'Markdown';
    case 'text':
      return 'текст';
    case 'xlsx':
      return 'Excel';
    case 'pptx':
      return 'PowerPoint';
    case 'html':
      return 'HTML';
    case 'rtf':
      return 'RTF';
    case 'odt':
      return 'ODT';
    case 'csv':
      return 'CSV';
    case 'other':
    default:
      return 'другое';
  }
}

/** RU-метка СМЫСЛОВОГО типа документа (`DocumentType`). */
export function documentTypeLabel(docType: DocumentTypeApi | null): string {
  switch (docType) {
    case 'regulation':
      return 'Регламент';
    case 'policy':
      return 'Политика';
    case 'instruction':
      return 'Инструкция';
    case 'process':
      return 'Процесс';
    case 'job_description':
      return 'Должностная инструкция';
    case 'other':
      return 'другое';
    default:
      return '—';
  }
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

/** Атрибуция, общая для пакета файлов (ТЗ-4 Ф3/Ф5). Все поля опц. */
export interface DocumentAttribution {
  attachedRoleId?: string | null;
  attachedThemeId?: string | null;
  attachedProjectId?: string | null;
  docType?: DocumentTypeApi | null;
}

/** Аргументы одиночной загрузки (обратная совместимость). */
export interface UploadDocumentArgs extends DocumentAttribution {
  file: File;
}

/** Аргументы пакетной загрузки (ТЗ-4 Ф5 — несколько файлов за раз). */
export interface UploadDocumentsBatchArgs extends DocumentAttribution {
  files: File[];
}

/** Один элемент ответа загрузки. `deduped:true` — дубликат по contentHash. */
export interface UploadDocumentItemApi {
  id: string;
  status: DocumentStatusApi;
  name: string;
  deduped: boolean;
}

export interface UploadDocumentsResponseApi {
  items: UploadDocumentItemApi[];
}

/** Дописывает поля атрибуции в FormData (только заданные). */
function appendAttribution(form: FormData, attr: DocumentAttribution): void {
  if (attr.attachedRoleId) form.append('attachedRoleId', attr.attachedRoleId);
  if (attr.attachedThemeId) form.append('attachedThemeId', attr.attachedThemeId);
  if (attr.attachedProjectId)
    form.append('attachedProjectId', attr.attachedProjectId);
  if (attr.docType) form.append('docType', attr.docType);
}

async function postDocumentsMultipart(
  orgId: string,
  form: FormData,
): Promise<UploadDocumentsResponseApi> {
  const baseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
  const url = `${baseUrl.replace(/\/+$/, '')}/api/v1/documents`;

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
  return (await res.json()) as UploadDocumentsResponseApi;
}

/**
 * Пакетная загрузка (ТЗ-4 Ф5): несколько файлов в одном multipart-запросе под
 * полем `files`. Не идём через apiClient (он JSON-only), но соблюдаем те же
 * headers (X-Org-Id) и cookie-сессию.
 */
async function uploadDocumentsBatch(
  orgId: string,
  args: UploadDocumentsBatchArgs,
): Promise<UploadDocumentsResponseApi> {
  const form = new FormData();
  for (const file of args.files) form.append('files', file);
  appendAttribution(form, args);
  return postDocumentsMultipart(orgId, form);
}

/**
 * Одиночная загрузка (обратная совместимость для прочих вызывающих). Шлёт
 * файл под legacy-полем `file`; backend по-прежнему его принимает.
 */
async function uploadDocumentMultipart(
  orgId: string,
  args: UploadDocumentArgs,
): Promise<UploadDocumentsResponseApi> {
  const form = new FormData();
  form.append('file', args.file);
  appendAttribution(form, args);
  return postDocumentsMultipart(orgId, form);
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

  /** Пакетная загрузка нескольких файлов с общей атрибуцией (ТЗ-4 Ф5). */
  uploadBatch: uploadDocumentsBatch,
};
