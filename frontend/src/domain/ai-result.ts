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
};

export type AiResultApi = {
  summary: string;
  structuredData: unknown;
  customOutputMd: string | null;
  followUpEmail: string | null;
  tasks: unknown;
  modelUsed: string;
  createdAt: string;
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
  };
}
