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

/** Нормализация заголовка для дедупа: lowercase, без скобочных уточнений, числа без разделителей тысяч, без пунктуации. НЕ fuzzy. */
export function normTaskTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ') // «Набрать команду (3 чел)» → «Набрать команду»
    .replace(/(?<=\d)[\s ]+(?=\d)/g, '') // «2 000»→«2000», «1 000 000»→«1000000» (вкл. NBSP)
    .replace(/[«»"'`.,;:!?()…]/g, ' ') // пунктуация → пробел
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * ТЗ 2026-06-06 meeting-report-reliability-and-ui-honesty, Фаза 2 (S6-03):
 * показываем ВСЕ извлечённые задачи. Раньше «есть fast → только fast» прятало
 * main-задачи (на проде fast=1, main=5 → видно было 1 из 6). Теперь объединяем
 * fast и main (v2/legacy/ручные) с дедупом по нормализованному заголовку
 * (fast приоритетнее при дубле). Нормализация — normTaskTitle (НЕ fuzzy):
 * lowercase, без скобочных уточнений, числа без разделителей тысяч, без пунктуации,
 * чтобы не схлопывать реально разные задачи.
 *
 * Используется в пользовательском UI карточки/журнала встречи.
 * Admin compare UI продолжает показывать оба варианта рядом.
 */
export function pickPrimaryTasks(items: TaskDomain[]): TaskDomain[] {
  const norm = (t: TaskDomain) => normTaskTitle(t.title);
  const fast = items.filter((t) => t.extractorVersion === 'fast');
  const seen = new Set(fast.map(norm));
  const rest = items.filter(
    (t) =>
      (t.extractorVersion === 'v2' || t.extractorVersion === null) &&
      !seen.has(norm(t)),
  );
  return [...fast, ...rest];
}
