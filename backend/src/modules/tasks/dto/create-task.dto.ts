import { z } from 'zod';

export const CreateTaskSchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().max(5000).nullish(),
  assigneeRaw: z.string().max(200).nullish(),
  dueDate: z.string().datetime({ offset: true }).nullish().or(z.string().date().nullish()),
});

export type CreateTaskDto = z.infer<typeof CreateTaskSchema>;
