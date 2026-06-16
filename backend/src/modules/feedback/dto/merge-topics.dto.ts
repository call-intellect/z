import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const MergeTopicsSchema = z.object({
  targetId: z.string().min(1),
});
export type MergeTopicsBody = z.infer<typeof MergeTopicsSchema>;
export class MergeTopicsDto extends createZodDto(MergeTopicsSchema) {}
