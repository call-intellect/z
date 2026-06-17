import { z } from 'zod';

export const RecognitionTypeSchema = z.enum([
  'thanks_comment',
  'thanks_helpfulness',
  'mention_helped',
  'idea_shipped',
  'streak_milestone',
  'weekly_summary',
]);
export type RecognitionType = z.infer<typeof RecognitionTypeSchema>;

export const RecognitionVisibilitySchema = z.enum(['private', 'team', 'public_org']);
export type RecognitionVisibility = z.infer<typeof RecognitionVisibilitySchema>;

export const ListRecognitionsQuerySchema = z.object({
  type: RecognitionTypeSchema.optional(),
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u, 'Ожидается YYYY-MM-DD')
    .optional(),
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
  recentRecognitions: RecognitionResponseDto[];
}

export interface BadgeDto {
  id: string;
  slug: string;
  name: string;
  description: string;
  iconUrl: string | null;
  condition: Record<string, unknown>;
}

export interface ToggleThanksResponseDto {
  thanksCount: number;
  thankedByMe: boolean;
}

export interface TeamSpotlightPersonDto {
  personId: string | null;
  userId: string;
  name: string;
  avatar: string | null;
  highlightReason: string;
  recognitionCount: number;
  thanksReceived: number;
}

export interface TeamSpotlightResponseDto {
  period: {
    from: string;
    to: string;
  };
  persons: TeamSpotlightPersonDto[];
}

export const RecognitionOptOutBodySchema = z.object({
  publicVisible: z.boolean(),
});
export type RecognitionOptOutBody = z.infer<typeof RecognitionOptOutBodySchema>;

export interface RecognitionOptOutResponseDto {
  publicVisible: boolean;
  updatedAt: string;
}
