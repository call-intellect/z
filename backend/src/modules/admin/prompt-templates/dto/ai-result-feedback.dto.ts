import { z } from 'zod';

export const REACTIONS = ['positive', 'negative'] as const;
export type Reaction = (typeof REACTIONS)[number];

export const CreateFeedbackSchema = z.object({
  reaction: z.enum(REACTIONS),
  comment: z.string().max(2000).nullable().optional(),
});
export type CreateFeedbackDto = z.infer<typeof CreateFeedbackSchema>;

export const ListFeedbackQuerySchema = z.object({
  versionId: z.string().min(1).max(60).optional(),
  templateId: z.string().min(1).max(60).optional(),
  reaction: z.enum(REACTIONS).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListFeedbackQueryDto = z.infer<typeof ListFeedbackQuerySchema>;
