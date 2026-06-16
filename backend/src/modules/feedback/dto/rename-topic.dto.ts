import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const RenameTopicSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(500),
});
export type RenameTopicBody = z.infer<typeof RenameTopicSchema>;
export class RenameTopicDto extends createZodDto(RenameTopicSchema) {}
