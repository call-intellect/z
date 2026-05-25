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
  /**
   * Сводка предыдущего поколения (knowledge-core v2). Fallback, если
   * `summaryFast` ещё не сгенерирован.
   */
  summaryV2: string | null;
  summaryV2Model: string | null;
  summaryV2GeneratedAt: Date | null;
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
  summaryV2: string | null;
  summaryV2Model: string | null;
  summaryV2GeneratedAt: string | null;
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
    summaryV2: api.summaryV2 ?? null,
    summaryV2Model: api.summaryV2Model ?? null,
    summaryV2GeneratedAt: api.summaryV2GeneratedAt
      ? new Date(api.summaryV2GeneratedAt)
      : null,
  };
}

/**
 * ТЗ 2026-05-25 meeting-report-split, Фаза 6 — выбирает приоритетную сводку
 * для пользовательского UI:
 *   1. `summaryFast` — новый объединённый отчёт (`MeetingReportFastWorker`);
 *   2. `summaryV2` — knowledge-core v2 (fallback, пока fast параллельно
 *      собирает данные);
 *   3. `summary` — legacy single-step prompt.
 *
 * Возвращает trimmed-строку или `null`, если все три отсутствуют/пустые.
 */
export function pickPrimarySummary(
  ai: Pick<AiResultDomain, 'summaryFast' | 'summaryV2' | 'summary'> | null,
): { markdown: string; source: 'fast' | 'v2' | 'legacy' } | null {
  if (!ai) return null;
  const fast = ai.summaryFast?.trim();
  if (fast) return { markdown: fast, source: 'fast' };
  const v2 = ai.summaryV2?.trim();
  if (v2) return { markdown: v2, source: 'v2' };
  const legacy = ai.summary?.trim();
  if (legacy) return { markdown: legacy, source: 'legacy' };
  return null;
}
