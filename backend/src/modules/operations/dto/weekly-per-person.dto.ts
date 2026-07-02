import { z } from 'zod';

export const WeeklyPerPersonQuerySchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_week_start'),
  weekEnd: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_week_end')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(5),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z.enum(['risk']).default('risk'),
});
export type WeeklyPerPersonQuery = z.infer<typeof WeeklyPerPersonQuerySchema>;

export interface WeeklyPersonRowDto {
  personId: string;
  personName: string;
  departmentName: string | null;
  tasksDone: number;
  tasksPlanned: number;
  tasksNotDone: number;
  checkInsCompleted: number;
  goalContributionNet: number | null;
}

export interface WeeklyPerPersonDto {
  weekStart: string;
  weekEnd: string;
  generatedAt: string;
  total: number;
  topRisk: WeeklyPersonRowDto[];
  rows: WeeklyPersonRowDto[];
}

export interface MyWeeklyPerPersonDto {
  weekStart: string;
  weekEnd: string;
  row: WeeklyPersonRowDto | null;
}

export const WeeklyPersonItemsQuerySchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_week_start'),
  weekEnd: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_week_end')
    .optional(),
});
export type WeeklyPersonItemsQuery = z.infer<typeof WeeklyPersonItemsQuerySchema>;

export type WeeklyPersonItemKind = 'task' | 'checkin';

export type WeeklyPersonItemFactStatus = 'done' | 'open' | 'overdue' | 'planned';

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
