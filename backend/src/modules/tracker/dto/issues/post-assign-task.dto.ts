import { z } from 'zod';

export const PostAssignTaskBodySchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    assigneeName: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5_000).optional(),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    viaRouting: z.boolean().optional(),
  })
  .strict();

export type PostAssignTaskBodyDto = z.infer<typeof PostAssignTaskBodySchema>;

export interface PostAssignTaskResponseDto {
  id: string;
  title: string;
  projectId: string;
  status: string;
  assignee?: { userId: string; name: string };
  needsAssignee?: boolean;
  candidates?: Array<{ userId: string | null; name: string }>;
  message?: string;
}
