import { TaskStatus } from '@prisma/client';
import { z } from 'zod';

export const UpdateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    description: z.string().max(5000).nullish(),
    assigneeRaw: z.string().max(200).nullish(),
    dueDate: z.string().datetime({ offset: true }).nullish().or(z.string().date().nullish()),
    status: z.nativeEnum(TaskStatus).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'нужно передать хотя бы одно поле',
  });

export type UpdateTaskDto = z.infer<typeof UpdateTaskSchema>;
