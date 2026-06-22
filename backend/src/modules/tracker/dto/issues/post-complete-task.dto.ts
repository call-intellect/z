import { z } from 'zod';

export const PostCompleteTaskBodySchema = z
  .object({
    taskName: z.string().trim().min(1).max(200),
    note: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();

export type PostCompleteTaskBodyDto = z.infer<typeof PostCompleteTaskBodySchema>;

export interface PostCompleteTaskResponseDto {
  candidateId: string;
  issueId: string;
  title: string;
  status: string;
}
