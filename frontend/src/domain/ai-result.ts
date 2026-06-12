/**
 * Доменная модель результата AI-обработки встречи.
 * `structuredData` зависит от `meeting.type`; `tasks` — массив объектов;
 * `customOutputMd` — markdown, рендерится через `react-markdown`.
 */

export type AiTask = {
  title: string;
  assignee?: string | null;
  due?: string | null;
};

export type AiResultDomain = {
  summary: string;
  structuredData: unknown;
  customOutputMd: string | null;
  followUpEmail: string | null;
  tasks: AiTask[] | null;
  modelUsed: string;
  createdAt: Date;
  /**
   * ТЗ 2026-05-25 meeting-report-split, Фаза 6 — приоритетная сводка
   * (`MeetingReportFastWorker`). Если задано — рендерится как markdown.
   */
  summaryFast: string | null;
  summaryFastModel: string | null;
  summaryFastGeneratedAt: Date | null;
};

export type AiResultApi = {
  summary: string;
  structuredData: unknown;
  customOutputMd: string | null;
  followUpEmail: string | null;
  tasks: unknown;
  modelUsed: string;
  createdAt: string;
  summaryFast: string | null;
  summaryFastModel: string | null;
  summaryFastGeneratedAt: string | null;
};

function tasksFromApi(raw: unknown): AiTask[] | null {
  if (!Array.isArray(raw)) return null;
  const tasks: AiTask[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const obj = item as Record<string, unknown>;
    const title = typeof obj.title === 'string' ? obj.title : null;
    if (!title) continue;
    tasks.push({
      title,
      assignee:
        typeof obj.assignee === 'string'
          ? obj.assignee
          : typeof obj.owner === 'string'
            ? obj.owner
            : null,
      due:
        typeof obj.due === 'string'
          ? obj.due
          : typeof obj.deadline === 'string'
            ? obj.deadline
            : null,
    });
  }
  return tasks.length === 0 ? null : tasks;
}

export function aiResultFromApi(api: AiResultApi): AiResultDomain {
  return {
    summary: api.summary,
    structuredData: api.structuredData ?? null,
    customOutputMd: api.customOutputMd ?? null,
    followUpEmail: api.followUpEmail ?? null,
    tasks: tasksFromApi(api.tasks),
    modelUsed: api.modelUsed,
    createdAt: new Date(api.createdAt),
    summaryFast: api.summaryFast ?? null,
    summaryFastModel: api.summaryFastModel ?? null,
    summaryFastGeneratedAt: api.summaryFastGeneratedAt
      ? new Date(api.summaryFastGeneratedAt)
      : null,
  };
}

/**
 * ТЗ 2026-05-25 meeting-report-split, Фаза 6 — выбирает приоритетную сводку
 * для пользовательского UI:
 *   1. `summaryFast` — новый объединённый отчёт (`MeetingReportFastWorker`);
 *   2. `summary` — legacy single-step prompt.
 *
 * v2-ветка удалена 2026-06-10 вместе с мёртвым v2-стеком.
 *
 * Возвращает trimmed-строку или `null`, если оба отсутствуют/пустые.
 */
export function pickPrimarySummary(
  ai: Pick<AiResultDomain, 'summaryFast' | 'summary'> | null,
): { markdown: string; source: 'fast' | 'legacy' } | null {
  if (!ai) return null;
  const fast = ai.summaryFast?.trim();
  if (fast) return { markdown: fast, source: 'fast' };
  const legacy = ai.summary?.trim();
  if (legacy) return { markdown: legacy, source: 'legacy' };
  return null;
}
