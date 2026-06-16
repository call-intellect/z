import { FeedbackTopicStatus } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const FeedbackTopicStatusSchema = z.nativeEnum(FeedbackTopicStatus);

export const FeedbackTopicSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  status: FeedbackTopicStatusSchema,
  itemsCount: z.number().int().nonnegative(),
  uniqueUsersCount: z.number().int().nonnegative(),
  percentOfWindow: z.number().min(0).max(100),
  lastItemAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type FeedbackTopicSummary = z.infer<typeof FeedbackTopicSummarySchema>;
export class FeedbackTopicSummaryDto extends createZodDto(FeedbackTopicSummarySchema) {}

export const FeedbackTopicsListResponseSchema = z.object({
  items: z.array(FeedbackTopicSummarySchema),
  totalItemsInWindow: z.number().int().nonnegative(),
  totalUsersInWindow: z.number().int().nonnegative(),
  totalTopicsInWindow: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type FeedbackTopicsListResponse = z.infer<typeof FeedbackTopicsListResponseSchema>;
export class FeedbackTopicsListResponseDto extends createZodDto(FeedbackTopicsListResponseSchema) {}

export const FeedbackTopicDetailSchema = FeedbackTopicSummarySchema.extend({
  archivedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
  mergedIntoId: z.string().nullable(),
});
export type FeedbackTopicDetail = z.infer<typeof FeedbackTopicDetailSchema>;
export class FeedbackTopicDetailDto extends createZodDto(FeedbackTopicDetailSchema) {}
