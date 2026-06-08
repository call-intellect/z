import type { IdeaKind, IdeaStatus } from '@prisma/client';
import { z } from 'zod';

export const IdeaKindSchema = z.enum(['internal', 'client_request']);
export const IdeaStatusSchema = z.enum([
  'captured',
  'in_discussion',
  'accepted',
  'in_progress',
  'shipped',
  'rejected',
  'archived',
]);
export type IdeaKindDto = z.infer<typeof IdeaKindSchema>;
export type IdeaStatusDto = z.infer<typeof IdeaStatusSchema>;

// ────────────── List ──────────────

export const ListIdeasQuerySchema = z
  .object({
    kind: IdeaKindSchema.optional(),
    status: IdeaStatusSchema.optional(),
    q: z.string().max(200).optional(),
    clusterId: z.string().max(64).optional(),
    supporterEntityId: z.string().max(64).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type ListIdeasQuery = z.infer<typeof ListIdeasQuerySchema>;

export interface IdeaListItemDto {
  id: string;
  kind: IdeaKind;
  status: IdeaStatus;
  statement: string;
  rationale: string | null;
  weight: number;
  supporterCount: number;
  clusterId: string | null;
  firstProposedAt: string;
  lastDiscussedAt: string;
  createdByUserId: string | null;
}
export interface ListIdeasResponse {
  items: IdeaListItemDto[];
  total: number;
  page: number;
  limit: number;
}

// ────────────── Top (Ф4.A — лента идей, виджет дашборда) ──────────────

/**
 * TZ-1 Фаза 4.A (daily-value-engine) — `GET /api/v1/ideas/top?limit=`.
 * Топ идей по ре-ранку (weight + свежесть lastDiscussedAt + связь с целью).
 * Сделано по образцу `GET /insights/top` (виджет Director Dashboard).
 */
export const TopIdeasQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(10),
  })
  .strict();
export type TopIdeasQuery = z.infer<typeof TopIdeasQuerySchema>;

export interface TopIdeasResponse {
  items: IdeaListItemDto[];
}

// ────────────── Detail ──────────────

export interface IdeaSupporterDto {
  kind: 'person' | 'customer';
  entityId: string;
  firstSupportedAt: string;
  blockId?: string;
}
export interface IdeaDetailDto extends IdeaListItemDto {
  supporters: IdeaSupporterDto[];
  sourceBlockIds: string[];
  personSubjectIds: string[];
  statusChangedAt: string | null;
  statusChangedByUserId: string | null;
  statusReason: string | null;
  confidence: number;
  dataClass: string;
}

// ────────────── Status change ──────────────

export const ChangeIdeaStatusBodySchema = z
  .object({
    newStatus: IdeaStatusSchema,
    reason: z.string().max(4_000).nullable().optional(),
  })
  .strict();
export type ChangeIdeaStatusBody = z.infer<typeof ChangeIdeaStatusBodySchema>;

// ────────────── Link idea → goal (Goals OKR v2, Фаза 5) ──────────────

/**
 * Goals OKR v2 (Фаза 5, мост к гипотезам). Привязать идею к цели —
 * «эта гипотеза двигает цель X». `goalId = null` — отвязать.
 */
export const LinkIdeaGoalSchema = z
  .object({
    goalId: z.string().min(1).nullable(),
  })
  .strict();
export type LinkIdeaGoalBody = z.infer<typeof LinkIdeaGoalSchema>;

// ────────────── My Ideas ──────────────

export const MyIdeasQuerySchema = z
  .object({
    role: z.enum(['author', 'supporter']).default('author'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type MyIdeasQuery = z.infer<typeof MyIdeasQuerySchema>;

// ────────────── Clusters ──────────────

export const ListIdeaClustersQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type ListIdeaClustersQuery = z.infer<typeof ListIdeaClustersQuerySchema>;

export interface IdeaClusterDto {
  id: string;
  name: string;
  description: string | null;
  ideaIds: string[];
  clusterWeight: number;
  createdAt: string;
  updatedAt: string;
}
export interface ListIdeaClustersResponse {
  items: IdeaClusterDto[];
  total: number;
  page: number;
  limit: number;
}
