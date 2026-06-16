import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const FeedbackMessageSchema = z.object({
  id: z.string(),
  text: z.string(),
  createdAt: z.string().datetime(),
  processedAt: z.string().datetime().nullable(),
});
export type FeedbackMessage = z.infer<typeof FeedbackMessageSchema>;
export class FeedbackMessageDto extends createZodDto(FeedbackMessageSchema) {}

export const FeedbackMessagesListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type FeedbackMessagesListQuery = z.infer<typeof FeedbackMessagesListQuerySchema>;

export const FeedbackMessagesListResponseSchema = z.object({
  items: z.array(FeedbackMessageSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type FeedbackMessagesListResponse = z.infer<typeof FeedbackMessagesListResponseSchema>;
export class FeedbackMessagesListResponseDto extends createZodDto(
  FeedbackMessagesListResponseSchema,
) {}

export const FeedbackLimitResponseSchema = z.object({
  usedToday: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  resetAt: z.string().datetime(),
});
export type FeedbackLimitResponse = z.infer<typeof FeedbackLimitResponseSchema>;
export class FeedbackLimitResponseDto extends createZodDto(FeedbackLimitResponseSchema) {}

export const FeedbackFailedMessageSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userEmail: z.string(),
  text: z.string(),
  createdAt: z.string().datetime(),
  failedRuns: z.number().int().nonnegative(),
});
export type FeedbackFailedMessage = z.infer<typeof FeedbackFailedMessageSchema>;

export const FeedbackFailedMessagesListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type FeedbackFailedMessagesListQuery = z.infer<typeof FeedbackFailedMessagesListQuerySchema>;

export const FeedbackFailedMessagesListResponseSchema = z.object({
  items: z.array(FeedbackFailedMessageSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type FeedbackFailedMessagesListResponse = z.infer<
  typeof FeedbackFailedMessagesListResponseSchema
>;
export class FeedbackFailedMessagesListResponseDto extends createZodDto(
  FeedbackFailedMessagesListResponseSchema,
) {}
