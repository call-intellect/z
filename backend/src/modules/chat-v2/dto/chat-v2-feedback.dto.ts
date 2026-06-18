import { z } from 'zod';

export const ChatV2FeedbackBodySchema = z
  .object({
    helpful: z.enum(['up', 'down']),
    comment: z.string().trim().max(2000).optional(),
  })
  .strict();
export type ChatV2FeedbackBody = z.infer<typeof ChatV2FeedbackBodySchema>;

export const ChatV2UsageStatsQuerySchema = z
  .object({
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    scope: z.enum(['self', 'org']).optional().default('self'),
  })
  .strict();
export type ChatV2UsageStatsQuery = z.infer<typeof ChatV2UsageStatsQuerySchema>;

export interface ChatV2UsageStatsDto {
  from: string;
  to: string;
  scope: 'self' | 'org';
  asked: number;
  answered: number;
  answeredWithCitation: number;
  rated: number;
  helpedUp: number;
  helpedRatePercent: number | null;
  feedbackCoveragePercent: number;
  groundedRatePercent: number;
  helpedRateHidden: boolean;
  minRated: number;
}
