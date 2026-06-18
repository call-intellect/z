import { z } from 'zod';

export const WeeklyPerPersonQuerySchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_week_start'),
  limit: z.coerce.number().int().min(1).max(100).default(5),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z.enum(['reliability', 'risk']).default('reliability'),
});
export type WeeklyPerPersonQuery = z.infer<typeof WeeklyPerPersonQuerySchema>;

export interface WeeklyPersonRowDto {
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

export interface WeeklyPerPersonDto {
  weekStart: string;
  weekEnd: string;
  generatedAt: string;
  total: number;
  topReliable: WeeklyPersonRowDto[];
  topRisk: WeeklyPersonRowDto[];
  rows: WeeklyPersonRowDto[];
}

export interface MyWeeklyPerPersonDto {
  weekStart: string;
  weekEnd: string;
  row: WeeklyPersonRowDto | null;
  teamAverageReliabilityPercent: number | null;
}

export const WeeklyPersonItemsQuerySchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_week_start'),
});
export type WeeklyPersonItemsQuery = z.infer<typeof WeeklyPersonItemsQuerySchema>;

export type WeeklyPersonItemKind = 'task' | 'commitment' | 'checkin';

export type WeeklyPersonItemFactStatus =
  | 'done'
  | 'open'
  | 'overdue'
  | 'fulfilled'
  | 'missed'
  | 'asked'
  | 'planned';

export interface WeeklyPersonItemDto {
  kind: WeeklyPersonItemKind;
  title: string;
  plannedDue: string | null;
  factStatus: WeeklyPersonItemFactStatus;
  blockedBy: string | null;
}

export interface WeeklyPersonItemsDto {
  personId: string;
  weekStart: string;
  weekEnd: string;
  items: WeeklyPersonItemDto[];
}
