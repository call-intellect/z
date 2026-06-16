import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const FeedbackTopicWindowSchema = z.enum(['30', '90', 'all']);
export type FeedbackTopicWindow = z.infer<typeof FeedbackTopicWindowSchema>;

export const FeedbackTopicSortSchema = z.enum(['percent', 'users', 'recent']);
export type FeedbackTopicSort = z.infer<typeof FeedbackTopicSortSchema>;

export const TopicListFiltersSchema = z.object({
  window: FeedbackTopicWindowSchema.default('30'),
  q: z.string().trim().min(1).max(200).optional(),
  includeArchived: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === 'true'),
  sort: FeedbackTopicSortSchema.default('percent'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type TopicListFilters = z.infer<typeof TopicListFiltersSchema>;
export class TopicListFiltersDto extends createZodDto(TopicListFiltersSchema) {}

export const TopicDetailsQuerySchema = z.object({
  window: FeedbackTopicWindowSchema.default('30'),
});
export type TopicDetailsQuery = z.infer<typeof TopicDetailsQuerySchema>;
export class TopicDetailsQueryDto extends createZodDto(TopicDetailsQuerySchema) {}
