import { z } from 'zod';

export const PostMeTaskBodySchema = z
  .object({
    title: z.string().min(1, 'Заголовок задачи обязателен').max(500),
    description: z.string().max(50_000).nullable().optional(),
    dueDate: z.coerce.date().nullable().optional(),
  })
  .strict();

export type PostMeTaskBodyDto = z.infer<typeof PostMeTaskBodySchema>;

export interface PostMeTaskResponseDto {
  id: string;
  title: string;
  projectId: string;
  status: string;
}
