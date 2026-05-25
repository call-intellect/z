import type { TaskApi, TaskStatus } from '@/api/tasks.api';

export type TaskDomain = {
  id: string;
  meetingId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  assignee: string | null;
  dueDate: Date | null;
  sourceStartMs: number | null;
  sourceEndMs: number | null;
  sourceQuote: string | null;
  confidence: number | null;
  createdManually: boolean;
  createdAt: Date;
  updatedAt: Date;
  /**
   * ТЗ 2026-05-25 meeting-report-split, Фаза 6 — метка генератора.
   * Используется UI для фильтрации (fast → приоритет, v2/null → fallback).
   */
  extractorVersion: string | null;
};

export function taskFromApi(api: TaskApi): TaskDomain {
  return {
    id: api.id,
    meetingId: api.meetingId,
    title: api.title,
    description: api.description ?? null,
    status: api.status,
    assignee: api.assigneeRaw ?? null,
    dueDate: api.dueDate ? new Date(api.dueDate) : null,
    sourceStartMs:
      typeof api.sourceStartMs === 'number' ? api.sourceStartMs : null,
    sourceEndMs:
      typeof api.sourceEndMs === 'number' ? api.sourceEndMs : null,
    sourceQuote: api.sourceQuote ?? null,
    confidence: typeof api.confidence === 'number' ? api.confidence : null,
    createdManually: api.createdManually,
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
    extractorVersion: api.extractorVersion ?? null,
  };
}

/**
 * ТЗ 2026-05-25 meeting-report-split, Фаза 6 — фильтр приоритета:
 *   - если есть хоть одна fast-задача → возвращаем только fast,
 *   - иначе возвращаем v2 + legacy (null + ручные) — как fallback.
 *
 * Используется ТОЛЬКО в пользовательском UI карточки встречи.
 * Admin compare UI продолжает показывать оба варианта рядом.
 */
export function pickPrimaryTasks(items: TaskDomain[]): TaskDomain[] {
  const fast = items.filter((t) => t.extractorVersion === 'fast');
  if (fast.length > 0) return fast;
  return items.filter(
    (t) => t.extractorVersion === 'v2' || t.extractorVersion === null,
  );
}
