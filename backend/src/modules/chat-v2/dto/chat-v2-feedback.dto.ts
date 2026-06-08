import { z } from 'zod';

/**
 * TZ-1 Фаза 5 (daily-value-engine) — DTO оценки ответов AI-чата + агрегатор
 * метрики чата (несущая часть value-recap).
 */

/** Body `POST /api/v1/chat-v2/messages/:id/feedback`. */
export const ChatV2FeedbackBodySchema = z
  .object({
    helpful: z.enum(['up', 'down']),
    comment: z.string().trim().max(2000).optional(),
  })
  .strict();
export type ChatV2FeedbackBody = z.infer<typeof ChatV2FeedbackBodySchema>;

/** Query `GET /api/v1/chat-v2/usage-stats?from=&to=&scope=`. */
export const ChatV2UsageStatsQuerySchema = z
  .object({
    /** YYYY-MM-DD; default — начало текущего месяца. */
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    /** YYYY-MM-DD; default — сейчас. */
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    /**
     * 'self' — только мои диалоги (любой пользователь);
     * 'org' — по всей Org (только owner/coo). Default 'self'.
     */
    scope: z.enum(['self', 'org']).optional().default('self'),
  })
  .strict();
export type ChatV2UsageStatsQuery = z.infer<typeof ChatV2UsageStatsQuerySchema>;

/** Ответ `/usage-stats` + поле в value-recap. */
export interface ChatV2UsageStatsDto {
  from: string;
  to: string;
  scope: 'self' | 'org';
  asked: number;
  answered: number;
  /** Ответы с привязкой к источнику (grounding-proxy, НЕ «дефлекция»). */
  answeredWithCitation: number;
  rated: number;
  helpedUp: number;
  /** helpedUp/rated, % (NULL = скрыт при rated < minRated, «мало данных»). */
  helpedRatePercent: number | null;
  /** rated/answered, % — покрытие фидбеком. */
  feedbackCoveragePercent: number;
  /** answeredWithCitation/answered, % — grounding-proxy. */
  groundedRatePercent: number;
  helpedRateHidden: boolean;
  minRated: number;
}
