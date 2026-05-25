/**
 * DTO для POST /api/v1/admin/feedback/topics/:sourceId/merge —
 * объединение двух блоков. Все items source переносятся на target,
 * source помечается status=MERGED, mergedIntoId=targetId.
 *
 * См. plans/tz/2026-05-25-user-feedback-with-ai-clustering.md.
 */

import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const MergeTopicsSchema = z.object({
  /// Куда сливаем items source-блока.
  targetId: z.string().min(1),
});
export type MergeTopicsBody = z.infer<typeof MergeTopicsSchema>;
export class MergeTopicsDto extends createZodDto(MergeTopicsSchema) {}
