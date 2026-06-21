export interface WorklogApi {
  id: string;
  issueId: string;
  userId: string;
  minutes: number;
  description: string | null;
  startedAt: string;
  createdAt: string;
}

export interface WorklogListApi {
  items: WorklogApi[];
  totalMinutes: number;
}

export interface Worklog {
  id: string;
  issueId: string;
  userId: string;
  minutes: number;
  description: string | null;
  startedAt: Date;
  createdAt: Date;
}

export function worklogFromApi(api: WorklogApi): Worklog {
  return {
    id: api.id,
    issueId: api.issueId,
    userId: api.userId,
    minutes: api.minutes,
    description: api.description,
    startedAt: new Date(api.startedAt),
    createdAt: new Date(api.createdAt),
  };
}

export function formatWorklogMinutes(minutes: number): string {
  if (minutes <= 0) return "0 мин";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins} мин`;
  if (mins === 0) return `${hours} ч`;
  return `${hours} ч ${mins} мин`;
}

export function worklogDateLabel(date: Date): string {
  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
