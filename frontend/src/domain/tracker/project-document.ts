/**
 * Доменная модель `ProjectDocument` (2026-05-27).
 *
 * Контракт: `backend/src/modules/tracker/dto/project-documents/project-document.dto.ts`
 * + `backend/src/modules/tracker/services/project-documents.service.ts`.
 */

// ─── ApiDto ─────────────────────────────────────────────────────────────────

/**
 * Полный документ с контентом (`GET /project-documents/:id`).
 */
export interface ProjectDocumentApi {
  id: string;
  tenantId: string;
  projectId: string;
  title: string;
  /** TipTap JSON. */
  content: unknown;
  contentHtml: string | null;
  contentStripped: string | null;
  parentId: string | null;
  sortOrder: number;
  pinned: boolean;
  entityId: string | null;
  createdById: string;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * Сводный вариант для списка (`GET /projects/:id/documents` + WS events).
 * `preview` — первые ~240 символов plain-text, сформированный сервером.
 */
export interface ProjectDocumentSummaryApi {
  id: string;
  tenantId: string;
  projectId: string;
  title: string;
  preview: string | null;
  parentId: string | null;
  sortOrder: number;
  pinned: boolean;
  entityId: string | null;
  createdById: string;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Связанная CRM-карточка (`GET /projects/:id/linked-cards`).
 */
export interface LinkedCardApi {
  id: string;
  name: string;
  kind: string;
  color: string;
  meetingCount: number;
  lastMeetingAt: string | null;
  contactName: string | null;
}

// ─── Domain ─────────────────────────────────────────────────────────────────

export interface ProjectDocument {
  id: string;
  tenantId: string;
  projectId: string;
  title: string;
  content: unknown;
  contentHtml: string | null;
  contentStripped: string | null;
  parentId: string | null;
  sortOrder: number;
  pinned: boolean;
  entityId: string | null;
  createdById: string;
  updatedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ProjectDocumentSummary {
  id: string;
  tenantId: string;
  projectId: string;
  title: string;
  preview: string | null;
  parentId: string | null;
  sortOrder: number;
  pinned: boolean;
  entityId: string | null;
  createdById: string;
  updatedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LinkedCard {
  id: string;
  name: string;
  kind: string;
  color: string;
  meetingCount: number;
  lastMeetingAt: Date | null;
  contactName: string | null;
}

// ─── Mappers ────────────────────────────────────────────────────────────────

const parseDate = (s: string | null | undefined): Date | null =>
  s ? new Date(s) : null;

export function projectDocumentFromApi(
  api: ProjectDocumentApi,
): ProjectDocument {
  return {
    id: api.id,
    tenantId: api.tenantId,
    projectId: api.projectId,
    title: api.title,
    content: api.content,
    contentHtml: api.contentHtml,
    contentStripped: api.contentStripped,
    parentId: api.parentId,
    sortOrder: api.sortOrder,
    pinned: api.pinned,
    entityId: api.entityId,
    createdById: api.createdById,
    updatedById: api.updatedById,
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
    deletedAt: parseDate(api.deletedAt),
  };
}

export function projectDocumentSummaryFromApi(
  api: ProjectDocumentSummaryApi,
): ProjectDocumentSummary {
  return {
    id: api.id,
    tenantId: api.tenantId,
    projectId: api.projectId,
    title: api.title,
    preview: api.preview,
    parentId: api.parentId,
    sortOrder: api.sortOrder,
    pinned: api.pinned,
    entityId: api.entityId,
    createdById: api.createdById,
    updatedById: api.updatedById,
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
  };
}

export function linkedCardFromApi(api: LinkedCardApi): LinkedCard {
  return {
    id: api.id,
    name: api.name,
    kind: api.kind,
    color: api.color,
    meetingCount: api.meetingCount,
    lastMeetingAt: parseDate(api.lastMeetingAt),
    contactName: api.contactName,
  };
}

// ─── UI helpers ─────────────────────────────────────────────────────────────

/**
 * Извлечь plain-text из TipTap JSON. Используется при локальном редактировании
 * (до auto-save сервер ещё не получил contentStripped). Простой обход:
 * рекурсивно собирает `text`-ноды.
 */
export function extractPlainTextFromTiptapJson(content: unknown): string {
  if (content === null || content === undefined) return '';
  const parts: string[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if (typeof obj.text === 'string') parts.push(obj.text);
    const children = obj.content;
    if (Array.isArray(children)) {
      for (const c of children) visit(c);
    }
  };
  visit(content);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Человекочитаемый kind карточки для UI «Связанные карточки».
 */
export function linkedCardKindLabel(kind: string): string {
  switch (kind) {
    case 'client':
      return 'Клиент';
    case 'deal':
      return 'Сделка';
    case 'project':
      return 'Проект';
    case 'topic':
      return 'Тема';
    case 'vendor':
      return 'Поставщик';
    case 'custom':
      return 'Карточка';
    default:
      return 'Карточка';
  }
}
