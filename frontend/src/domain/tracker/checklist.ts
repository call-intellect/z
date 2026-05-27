/**
 * Доменная модель чек-листа задачи (2026-05-27).
 *
 * Контракт: `backend/src/modules/tracker/dto/checklists/checklist.dto.ts`
 * + `backend/src/modules/tracker/services/checklists.service.ts`.
 */

// ─── ApiDto ─────────────────────────────────────────────────────────────────

export interface ChecklistItemApi {
  id: string;
  tenantId: string;
  checklistId: string;
  text: string;
  isDone: boolean;
  sequence: number;
  completedAt: string | null;
  completedById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistApi {
  id: string;
  tenantId: string;
  issueId: string;
  title: string;
  sequence: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  items: ChecklistItemApi[];
  totalCount: number;
  doneCount: number;
}

// ─── Domain ─────────────────────────────────────────────────────────────────

export interface ChecklistItem {
  id: string;
  tenantId: string;
  checklistId: string;
  text: string;
  isDone: boolean;
  sequence: number;
  completedAt: Date | null;
  completedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Checklist {
  id: string;
  tenantId: string;
  issueId: string;
  title: string;
  sequence: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  items: ChecklistItem[];
  totalCount: number;
  doneCount: number;
  // ─ computed ─
  /** Все пункты выполнены (totalCount>0 && totalCount==doneCount). */
  isFullyCompleted: boolean;
  /** Прогресс в долях [0..1]. Для пустого чек-листа = 0. */
  progressRatio: number;
}

// ─── Mappers ────────────────────────────────────────────────────────────────

const parseDate = (s: string | null | undefined): Date | null =>
  s ? new Date(s) : null;

export function checklistItemFromApi(api: ChecklistItemApi): ChecklistItem {
  return {
    id: api.id,
    tenantId: api.tenantId,
    checklistId: api.checklistId,
    text: api.text,
    isDone: api.isDone,
    sequence: api.sequence,
    completedAt: parseDate(api.completedAt),
    completedById: api.completedById,
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
  };
}

export function checklistFromApi(api: ChecklistApi): Checklist {
  const items = (api.items ?? []).map(checklistItemFromApi);
  const total = api.totalCount ?? items.length;
  const done = api.doneCount ?? items.filter((i) => i.isDone).length;
  return {
    id: api.id,
    tenantId: api.tenantId,
    issueId: api.issueId,
    title: api.title,
    sequence: api.sequence,
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
    deletedAt: parseDate(api.deletedAt),
    items,
    totalCount: total,
    doneCount: done,
    isFullyCompleted: total > 0 && total === done,
    progressRatio: total === 0 ? 0 : done / total,
  };
}

// ─── UI helpers ─────────────────────────────────────────────────────────────

/** Текст прогресса «3 / 7». Возвращает null если totalCount=0. */
export function checklistProgressLabel(
  total: number,
  done: number,
): string | null {
  if (total <= 0) return null;
  return `${done} / ${total}`;
}
