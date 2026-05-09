import { TaskStatus } from '@prisma/client';
import { z } from 'zod';

/**
 * `GET /api/v1/tasks` — все задачи юзера. Пагинация offset-based,
 * 1-индексированная страница (как в `MeetingsListQuery`).
 */
const STATUS_VALUES = Object.values(TaskStatus) as TaskStatus[];

function statusArray() {
  const enumValues = new Set<string>(STATUS_VALUES);
  return z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v): TaskStatus[] | undefined => {
      if (v === undefined) return undefined;
      const arr = Array.isArray(v) ? v : v.split(',');
      const cleaned = arr
        .map((s) => s.trim())
        .filter((s): s is TaskStatus => s.length > 0 && enumValues.has(s));
      return cleaned.length > 0 ? cleaned : undefined;
    });
}

export const ListTasksQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: statusArray(),
  meetingId: z.string().min(1).optional(),
  dueBefore: z
    .string()
    .datetime({ offset: true })
    .optional()
    .or(z.string().date().optional()),
  q: z.string().trim().min(1).max(200).optional(),
});

export type ListTasksQuery = z.infer<typeof ListTasksQuerySchema>;

/**
 * `POST /api/v1/tasks/bulk` — массовая операция.
 */
export const BulkTasksSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(1000),
  action: z.enum(['mark_done', 'delete']),
});

export type BulkTasksDto = z.infer<typeof BulkTasksSchema>;

/**
 * `POST /api/v1/tasks/:id/send` — отправить задачу в IntegrationDestination.
 */
export const SendTaskSchema = z.object({
  destinationId: z.string().min(1),
});

export type SendTaskDto = z.infer<typeof SendTaskSchema>;
