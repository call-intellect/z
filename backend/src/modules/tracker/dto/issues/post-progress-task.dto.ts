import { z } from 'zod';

export const PostProgressTaskBodySchema = z
  .object({
    taskName: z.string().trim().min(1).max(200),
    progress: z.string().trim().min(1).max(2000),
  })
  .strict();

export type PostProgressTaskBodyDto = z.infer<typeof PostProgressTaskBodySchema>;

export interface PostProgressTaskResponseDto {
  progressUpdateId: string;
  issueId: string;
  title: string;
}
