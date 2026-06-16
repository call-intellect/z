import { apiClient } from "./api-client";

export interface WeeklyPersonRowApi {
  personId: string;
  personName: string;
  departmentName: string | null;
  promisesGiven: number;
  promisesKept: number;
  promisesBroken: number;
  promisesOverdue: number;
  promisesNoAnswer: number;
  reliabilityPercent: number | null;
  tasksDone: number;
  tasksPlanned: number;
  tasksNotDone: number;
  checkInsCompleted: number;
}

export interface WeeklyPerPersonApi {
  weekStart: string;
  weekEnd: string;
  generatedAt: string;
  total: number;
  topReliable: WeeklyPersonRowApi[];
  topRisk: WeeklyPersonRowApi[];
  rows: WeeklyPersonRowApi[];
}

export type WeeklyPersonItemKindApi = "task" | "commitment" | "checkin";

export type WeeklyPersonItemFactStatusApi =
  | "done"
  | "open"
  | "overdue"
  | "fulfilled"
  | "missed"
  | "asked"
  | "planned";

export interface WeeklyPersonItemApi {
  kind: WeeklyPersonItemKindApi;
  title: string;
  plannedDue: string | null;
  factStatus: WeeklyPersonItemFactStatusApi;
  blockedBy: string | null;
}

export interface WeeklyPersonItemsApi {
  personId: string;
  weekStart: string;
  weekEnd: string;
  items: WeeklyPersonItemApi[];
}

export const weeklyPerPersonApi = {
  get: (
    weekStart: string,
    opts?: { limit?: number; offset?: number; sort?: "reliability" | "risk" },
  ) => {
    const p = new URLSearchParams({ weekStart });
    if (opts?.limit != null) p.set("limit", String(opts.limit));
    if (opts?.offset != null) p.set("offset", String(opts.offset));
    if (opts?.sort) p.set("sort", opts.sort);
    return apiClient.get<WeeklyPerPersonApi>(
      `/api/v1/dashboard/operations/weekly-per-person?${p.toString()}`,
    );
  },

  items: (weekStart: string, personId: string) => {
    const p = new URLSearchParams({ weekStart });
    return apiClient.get<WeeklyPersonItemsApi>(
      `/api/v1/dashboard/operations/weekly-per-person/${encodeURIComponent(
        personId,
      )}/items?${p.toString()}`,
    );
  },
};
