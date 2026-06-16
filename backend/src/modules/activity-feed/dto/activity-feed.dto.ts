import { z } from 'zod';

export const FeedTypeSchema = z.enum([
  'probe_question',
  'insight',
  'decision',
  'task',
  'idea',
  'conflict',
  'knowledge_change',
  'recognition',
  'blocker',
  'open_question',
  'activity',
]);
export type FeedTypeDto = z.infer<typeof FeedTypeSchema>;

export const FeedSourceTypeSchema = z.enum(['ai_agent', 'system', 'user']);
export type FeedSourceTypeDto = z.infer<typeof FeedSourceTypeSchema>;

export const FeedSeveritySchema = z.enum(['critical', 'high', 'normal', 'low']);
export type FeedSeverityDto = z.infer<typeof FeedSeveritySchema>;

export const FeedStatusSchema = z.enum([
  'emitted',
  'delivered',
  'seen',
  'responded',
  'actioned',
  'dismissed',
  'expired',
]);
export type FeedStatusDto = z.infer<typeof FeedStatusSchema>;

export const FeedVisibilitySchema = z.enum(['public_org', 'team', 'role', 'private']);
export type FeedVisibilityDto = z.infer<typeof FeedVisibilitySchema>;

export const FeedChannelSchema = z.enum(['in_app', 'telegram', 'email', 'mobile_push']);
export type FeedChannelDto = z.infer<typeof FeedChannelSchema>;

export const FeedReactionSchema = z.enum(['thanks', 'vote']);
export type FeedReactionDto = z.infer<typeof FeedReactionSchema>;

export const FeedIconTypeSchema = z.enum([
  'question',
  'bulb',
  'check',
  'warning',
  'flame',
  'thumbs',
]);
export type FeedIconTypeDto = z.infer<typeof FeedIconTypeSchema>;

export const FeedDigestModeSchema = z.enum(['realtime', 'daily_digest', 'weekly_digest', 'off']);
export type FeedDigestModeDto = z.infer<typeof FeedDigestModeSchema>;

export const ListFeedQuerySchema = z.object({
  feedType: FeedTypeSchema.optional(),
  severity: FeedSeveritySchema.optional(),
  status: FeedStatusSchema.optional(),
  teamId: z.string().min(1).max(60).optional(),
  projectId: z.string().min(1).max(60).optional(),
  goalId: z.string().min(1).max(60).optional(),
  sourceAgentName: z.string().min(1).max(120).optional(),
  viewedUserId: z.string().min(1).max(60).optional(),
  emittedFrom: z.string().datetime().optional(),
  emittedTo: z.string().datetime().optional(),
  scopedToMe: z.coerce.boolean().default(true),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListFeedQuery = z.infer<typeof ListFeedQuerySchema>;

export const ReactBodySchema = z.object({
  reaction: FeedReactionSchema,
});
export type ReactBody = z.infer<typeof ReactBodySchema>;

export const RespondBodySchema = z.object({
  note: z.string().max(2_000).optional(),
});

export const SubscriptionFiltersSchema = z.object({
  teamIds: z.array(z.string().min(1).max(60)).max(100).optional(),
  projectIds: z.array(z.string().min(1).max(60)).max(100).optional(),
  goalIds: z.array(z.string().min(1).max(60)).max(100).optional(),
  severities: z.array(FeedSeveritySchema).optional(),
  sourceAgents: z.array(z.string().min(1).max(120)).max(20).optional(),
});
export type SubscriptionFiltersDto = z.infer<typeof SubscriptionFiltersSchema>;

export const UpsertSubscriptionBodySchema = z.object({
  feedType: FeedTypeSchema,
  filters: SubscriptionFiltersSchema.default({}),
  digestMode: FeedDigestModeSchema.default('realtime'),
  channels: z.array(FeedChannelSchema).min(1).default(['in_app']),
});
export type UpsertSubscriptionBody = z.infer<typeof UpsertSubscriptionBodySchema>;

export const PatchSubscriptionBodySchema = z.object({
  filters: SubscriptionFiltersSchema.optional(),
  digestMode: FeedDigestModeSchema.optional(),
  channels: z.array(FeedChannelSchema).min(1).optional(),
});
export type PatchSubscriptionBody = z.infer<typeof PatchSubscriptionBodySchema>;

export interface FeedItemDto {
  id: string;
  tenantId: string;
  feedType: FeedTypeDto;
  sourceType: FeedSourceTypeDto;
  sourceAgentName: string | null;
  sourceUserId: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  title: string;
  summary: string | null;
  iconType: FeedIconTypeDto | null;
  severity: FeedSeverityDto;
  status: FeedStatusDto;
  visibility: FeedVisibilityDto;
  visibilityScope: {
    teamIds?: string[];
    roleIds?: string[];
    userIds?: string[];
  } | null;
  targetUserId: string | null;
  targetChannel: FeedChannelDto | null;
  teamId: string | null;
  projectId: string | null;
  goalId: string | null;
  reactions: {
    thanks: string[];
    votes: string[];
  };
  expiresAt: string | null;
  emittedAt: string;
  deliveredAt: string | null;
  seenAt: string | null;
  respondedAt: string | null;
  actionedAt: string | null;
}

export interface ListFeedResponseDto {
  items: FeedItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface FeedSubscriptionDto {
  id: string;
  userId: string;
  feedType: FeedTypeDto;
  filters: SubscriptionFiltersDto;
  digestMode: FeedDigestModeDto;
  channels: FeedChannelDto[];
  createdAt: string;
  updatedAt: string;
}

export const CoraFeedTypeSchema = z.enum([
  'all',
  'idea',
  'insight',
  'decision',
  'conflict',
  'blocker',
  'activity',
  'probe_question',
  'open_question',
]);
export type CoraFeedTypeDto = z.infer<typeof CoraFeedTypeSchema>;

export const CORA_FEED_TYPES = [
  'idea',
  'insight',
  'decision',
  'conflict',
  'blocker',
  'activity',
  'probe_question',
  'open_question',
] as const satisfies readonly Exclude<CoraFeedTypeDto, 'all'>[];

export const CoraSeveritySchema = z.enum(['info', 'warn', 'risk']);
export type CoraSeverityDto = z.infer<typeof CoraSeveritySchema>;

export const CoraWindowSchema = z
  .union([z.literal('all'), z.coerce.number().int().min(1).max(3650)])
  .default(30);

export const CoraFeedQuerySchema = z.object({
  type: CoraFeedTypeSchema.default('all'),
  window: CoraWindowSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type CoraFeedQuery = z.infer<typeof CoraFeedQuerySchema>;

export interface CoraFeedItemDto {
  id: string;
  type: Exclude<CoraFeedTypeDto, 'all'>;
  title: string;
  analysis?: string;
  severity: CoraSeverityDto;
  sourceRef?: {
    meetingId?: string;
    cite?: string;
  };
  createdAt: string;
  unread: boolean;
  payload?: Record<string, unknown>;
}

export interface CoraFeedResponseDto {
  items: CoraFeedItemDto[];
  counters: Record<Exclude<CoraFeedTypeDto, 'all'>, number>;
  unreadCount: number;
}

export interface CoraSeenResponseDto {
  ok: true;
  lastSeenAt: string;
}
