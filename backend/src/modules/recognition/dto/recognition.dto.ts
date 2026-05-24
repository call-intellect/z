/**
 * Wave 2 — Recognition + Gamification.
 *
 * Zod-схемы DTO для REST API модуля `recognition`. Используются через
 * `ZodValidationPipe` (см. backend/src/common/pipes/zod-validation.pipe.ts).
 *
 * Принципы:
 *   - Никаких рейтингов / leaderboard / очков-валюты — только индивидуальные числа.
 *   - Mute-фильтр deletedAt / archive не показывает истёкшие записи.
 *   - Все ответы маппятся через сервис, Prisma-модели наружу не отдаются.
 */
import { z } from 'zod';

// ─────────────────────────── Recognition types ─────────────────────────────

/**
 * Полный набор типов Recognition — должен совпадать с union'ом
 * `RecognitionFormulateJobData['type']` (см. core-queue/queues.ts).
 */
export const RecognitionTypeSchema = z.enum([
  'thanks_comment',
  'thanks_helpfulness',
  'mention_helped',
  'idea_shipped',
  'streak_milestone',
  'weekly_summary',
]);
export type RecognitionType = z.infer<typeof RecognitionTypeSchema>;

export const RecognitionVisibilitySchema = z.enum([
  'private',
  'team',
  'public_org',
]);
export type RecognitionVisibility = z.infer<
  typeof RecognitionVisibilitySchema
>;

// ─────────────────────────── List Recognitions ─────────────────────────────

export const ListRecognitionsQuerySchema = z.object({
  type: RecognitionTypeSchema.optional(),
  /** ISO date (YYYY-MM-DD) — нижняя граница createdAt. */
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u, 'Ожидается YYYY-MM-DD')
    .optional(),
  /** ISO date (YYYY-MM-DD) — верхняя граница createdAt (включая). */
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u, 'Ожидается YYYY-MM-DD')
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListRecognitionsQuery = z.infer<typeof ListRecognitionsQuerySchema>;

export interface RecognitionResponseDto {
  id: string;
  tenantId: string;
  fromUserId: string | null;
  toUserId: string;
  type: RecognitionType;
  contextEntityType: string | null;
  contextEntityId: string | null;
  message: string | null;
  visibility: RecognitionVisibility;
  createdAt: string;
}

export interface ListRecognitionsResponseDto {
  items: RecognitionResponseDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ─────────────────────────── Contributions ─────────────────────────────────

export interface ContributionsSnapshotDto {
  userId: string;
  ideasInDevelopment: number;
  ideasShipped: number;
  thanksReceived: number;
  thanksReceivedWeek: number;
  currentCheckinStreak: number;
  longestCheckinStreak: number;
  helpfulComments: number;
  probeQuestionsAnswered: number;
  /** ISO. NULL если snapshot никогда не считался (создаём пустой). */
  updatedAt: string | null;
}

export interface UserBadgeDto {
  id: string;
  badgeId: string;
  slug: string;
  name: string;
  description: string;
  iconUrl: string | null;
  awardedAt: string;
}

export interface MyContributionsResponseDto {
  snapshot: ContributionsSnapshotDto;
  badges: UserBadgeDto[];
  /** Последние 10 Recognition (toUserId = текущий user). */
  recentRecognitions: RecognitionResponseDto[];
}

// ─────────────────────────── Badges catalog ────────────────────────────────

export interface BadgeDto {
  id: string;
  slug: string;
  name: string;
  description: string;
  iconUrl: string | null;
  /** Условие выдачи в формате `{ type, threshold }`. */
  condition: Record<string, unknown>;
}

// ─────────────────────────── Toggle Thanks ─────────────────────────────────

export interface ToggleThanksResponseDto {
  /** Сколько user'ов нажали «спасибо» под этим комментарием после toggle. */
  thanksCount: number;
  /** `true` если текущий user сейчас «лайкнул» комментарий. */
  thankedByMe: boolean;
}
