import { z } from 'zod';

export const UpdateRetentionSchema = z.object({
  days: z.coerce.number().int().min(1).max(3650),
  reason: z.string().trim().min(10).max(1000),
});
export type UpdateRetentionDto = z.infer<typeof UpdateRetentionSchema>;

export const PreviewRetentionQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(3650).optional(),
});
export type PreviewRetentionQueryDto = z.infer<typeof PreviewRetentionQuerySchema>;

export interface RetentionPolicyItemDto {
  type: string;
  days: number;
  description: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

export interface RetentionPreviewDto {
  type: string;
  currentDays: number;
  proposedDays: number;
  affectedCount: number;
  exampleIds: string[];
  notCountable: boolean;
}
