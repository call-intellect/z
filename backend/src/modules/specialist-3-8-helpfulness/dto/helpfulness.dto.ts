import { z } from 'zod';

export const SocialContributionProfileDtoSchema = z.object({
  id: z.string(),
  userId: z.string(),
  helpProvidedCount: z.number().int().nonnegative(),
  proactiveHintCount: z.number().int().nonnegative(),
  mentoringCount: z.number().int().nonnegative(),
  emotionalSupportCount: z.number().int().nonnegative(),
  constructiveFeedbackCount: z.number().int().nonnegative(),
  expertiseTopics: z.array(z.string()),
  socialRoles: z.array(z.string()),
  lastWeekHelpCount: z.number().int().nonnegative(),
  lastMonthHelpCount: z.number().int().nonnegative(),
  contributionScoreCached: z.number().nullable(),
  buildVersion: z.number().int().nonnegative(),
  lastBuiltAt: z.string(),
});
export type SocialContributionProfileDto = z.infer<typeof SocialContributionProfileDtoSchema>;

export const HelpfulnessSpotlightDtoSchema = z.object({
  id: z.string(),
  helperUserId: z.string(),
  helperName: z.string().nullable(),
  topicHint: z.string().nullable(),
  message: z.string(),
  periodFrom: z.string(),
  periodTo: z.string(),
  helpCount: z.number().int().nonnegative(),
  status: z.enum(['pending', 'approved', 'published', 'hidden']),
  approvedByUserId: z.string().nullable(),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type HelpfulnessSpotlightDto = z.infer<typeof HelpfulnessSpotlightDtoSchema>;

export const ListSpotlightsQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'published', 'hidden']).optional().default('published'),
  helperUserId: z.string().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});
export type ListSpotlightsQuery = z.infer<typeof ListSpotlightsQuerySchema>;

export const ListSpotlightsResponseSchema = z.object({
  items: z.array(HelpfulnessSpotlightDtoSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
});
export type ListSpotlightsResponse = z.infer<typeof ListSpotlightsResponseSchema>;

export const HelpfulnessTraitDtoSchema = z.object({
  id: z.string(),
  traitType: z.string(),
  intensity: z.number(),
  topicHint: z.string().nullable(),
  evidenceQuote: z.string().nullable(),
  confidence: z.number(),
  visibility: z.string(),
  lastObservedAt: z.string(),
  status: z.string(),
});
export type HelpfulnessTraitDto = z.infer<typeof HelpfulnessTraitDtoSchema>;

export const TeamHelperRowSchema = z.object({
  userId: z.string(),
  name: z.string().nullable(),
  helpProvidedCount: z.number().int().nonnegative(),
  mentoringCount: z.number().int().nonnegative(),
  proactiveHintCount: z.number().int().nonnegative(),
  emotionalSupportCount: z.number().int().nonnegative(),
  lastWeekHelpCount: z.number().int().nonnegative(),
  topTopics: z.array(z.string()),
});
export type TeamHelperRow = z.infer<typeof TeamHelperRowSchema>;

export const UnansweredQuestionRowSchema = z.object({
  id: z.string(),
  recipientUserId: z.string().nullable(),
  recipientName: z.string().nullable(),
  helperUserId: z.string(),
  helperName: z.string().nullable(),
  topicHint: z.string().nullable(),
  evidenceQuote: z.string().nullable(),
  lastObservedAt: z.string(),
});
export type UnansweredQuestionRow = z.infer<typeof UnansweredQuestionRowSchema>;

export const SocialContributionOptOutBodySchema = z.object({ optedOut: z.boolean() }).strict();
export type SocialContributionOptOutBody = z.infer<typeof SocialContributionOptOutBodySchema>;

export interface SocialContributionOptOutDto {
  optedOut: boolean;
  updatedAt: string | null;
}
