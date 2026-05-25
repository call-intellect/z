/**
 * DTO для PATCH /api/v1/admin/feedback/topics/:id — переименование блока.
 *
 * См. plans/tz/2026-05-25-user-feedback-with-ai-clustering.md.
 */

import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const RenameTopicSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(500),
});
export type RenameTopicBody = z.infer<typeof RenameTopicSchema>;
export class RenameTopicDto extends createZodDto(RenameTopicSchema) {}
