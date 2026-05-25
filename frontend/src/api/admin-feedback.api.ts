/**
 * Admin Feedback API — клиент админ-стороны канала обратной связи.
 *
 * Контракт — `backend/src/modules/feedback/controllers/feedback-admin.controller.ts`.
 * Защита backend: CookieAuthGuard + SuperAdminGuard.
 *
 * Эндпоинты:
 *   - GET    /api/v1/admin/feedback/topics                              — список блоков
 *   - GET    /api/v1/admin/feedback/topics/:id                          — детали блока
 *   - GET    /api/v1/admin/feedback/topics/:id/items                    — items блока
 *   - GET    /api/v1/admin/feedback/topics/:id/items/:itemId/message    — исходный текст
 *   - PATCH  /api/v1/admin/feedback/topics/:id                          — rename (Phase 8)
 *   - POST   /api/v1/admin/feedback/topics/:sourceId/merge              — Phase 8
 *   - POST   /api/v1/admin/feedback/topics/:id/archive                  — Phase 8
 *   - POST   /api/v1/admin/feedback/topics/:id/unarchive                — Phase 8
 *   - POST   /api/v1/admin/feedback/digest/run                          — STUB (Phase 5)
 *   - GET    /api/v1/admin/feedback/messages/failed                     — failedRuns >= 3
 *
 * Фаза 7 ТЗ user-feedback-with-ai-clustering: чистый API-слой,
 * мапперы — в `src/domain/admin-feedback.ts`.
 */

import { z } from 'zod';

import { apiClient } from './api-client';
import { buildQuery } from './admin-helpers';

/* ─────────────────────────── enums ─────────────────────────── */

export const FEEDBACK_TOPIC_STATUSES = ['ACTIVE', 'ARCHIVED', 'MERGED'] as const;
export const FeedbackTopicStatusSchema = z.enum(FEEDBACK_TOPIC_STATUSES);
export type FeedbackTopicStatusApi = z.infer<typeof FeedbackTopicStatusSchema>;

export const FEEDBACK_WINDOWS = ['30', '90', 'all'] as const;
export const FeedbackTopicWindowSchema = z.enum(FEEDBACK_WINDOWS);
export type FeedbackTopicWindowApi = z.infer<typeof FeedbackTopicWindowSchema>;

export const FEEDBACK_SORTS = ['percent', 'users', 'recent'] as const;
export const FeedbackTopicSortSchema = z.enum(FEEDBACK_SORTS);
export type FeedbackTopicSortApi = z.infer<typeof FeedbackTopicSortSchema>;

/* ─────────────────────────── topics ─────────────────────────── */

const FeedbackTopicSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  status: FeedbackTopicStatusSchema,
  itemsCount: z.number().int().nonnegative(),
  uniqueUsersCount: z.number().int().nonnegative(),
  percentOfWindow: z.number().min(0).max(100),
  lastItemAt: z.string().nullable(),
  createdAt: z.string(),
});
export type FeedbackTopicSummaryApi = z.infer<typeof FeedbackTopicSummarySchema>;

export const FeedbackTopicsListResponseSchema = z.object({
  items: z.array(FeedbackTopicSummarySchema),
  totalItemsInWindow: z.number().int().nonnegative(),
  totalUsersInWindow: z.number().int().nonnegative(),
  totalTopicsInWindow: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type FeedbackTopicsListApi = z.infer<typeof FeedbackTopicsListResponseSchema>;

export const FeedbackTopicDetailSchema = FeedbackTopicSummarySchema.extend({
  archivedAt: z.string().nullable(),
  updatedAt: z.string(),
  mergedIntoId: z.string().nullable(),
});
export type FeedbackTopicDetailApi = z.infer<typeof FeedbackTopicDetailSchema>;

/* ─────────────────────────── items ─────────────────────────── */

const FeedbackItemAuthorSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
});

const FeedbackItemOrgSchema = z
  .object({
    id: z.string(),
    name: z.string(),
  })
  .nullable();

const FeedbackItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  createdAt: z.string(),
  messageId: z.string(),
  user: FeedbackItemAuthorSchema,
  org: FeedbackItemOrgSchema,
  discarded: z.boolean(),
  discardReason: z.string().nullable(),
});
export type FeedbackItemApi = z.infer<typeof FeedbackItemSchema>;

export const FeedbackItemsListResponseSchema = z.object({
  items: z.array(FeedbackItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type FeedbackItemsListApi = z.infer<typeof FeedbackItemsListResponseSchema>;

export const FeedbackItemMessageResponseSchema = z.object({
  id: z.string(),
  text: z.string(),
  createdAt: z.string(),
  userId: z.string(),
  orgId: z.string().nullable(),
  user: FeedbackItemAuthorSchema,
  org: FeedbackItemOrgSchema,
});
export type FeedbackItemMessageApi = z.infer<
  typeof FeedbackItemMessageResponseSchema
>;

/* ─────────────────────────── failed messages ─────────────────────────── */

const FeedbackFailedMessageSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userEmail: z.string(),
  text: z.string(),
  createdAt: z.string(),
  failedRuns: z.number().int().nonnegative(),
});
export type FeedbackFailedMessageApi = z.infer<typeof FeedbackFailedMessageSchema>;

export const FeedbackFailedMessagesListResponseSchema = z.object({
  items: z.array(FeedbackFailedMessageSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type FeedbackFailedMessagesListApi = z.infer<
  typeof FeedbackFailedMessagesListResponseSchema
>;

/* ─────────────────────────── digest ─────────────────────────── */

export const DigestRunResponseSchema = z.object({
  enqueued: z.boolean().optional(),
  jobId: z.string(),
});
export type DigestRunResponseApi = z.infer<typeof DigestRunResponseSchema>;

/* ─────────────────────────── mutations ─────────────────────────── */

export interface RenameTopicBody {
  title: string;
  description: string;
}

export interface MergeTopicsBody {
  targetId: string;
}

export interface MergeTopicsResultApi {
  movedItems: number;
  mergedIntoId: string;
}

/* ─────────────────────────── filter params ─────────────────────────── */

export interface ListTopicsParams {
  window?: FeedbackTopicWindowApi;
  q?: string;
  includeArchived?: boolean;
  sort?: FeedbackTopicSortApi;
  page?: number;
  pageSize?: number;
}

export interface GetTopicParams {
  window?: FeedbackTopicWindowApi;
}

export interface ListItemsParams {
  page?: number;
  pageSize?: number;
  groupByUser?: boolean;
}

/* ─────────────────────────── клиент ─────────────────────────── */

export const adminFeedbackApi = {
  async listTopics(params: ListTopicsParams = {}): Promise<FeedbackTopicsListApi> {
    const qs = buildQuery({
      window: params.window,
      q: params.q,
      includeArchived:
        params.includeArchived === undefined
          ? undefined
          : params.includeArchived
            ? 'true'
            : 'false',
      sort: params.sort,
      page: params.page,
      pageSize: params.pageSize,
    });
    const raw = await apiClient.get<unknown>(`/api/v1/admin/feedback/topics${qs}`);
    return FeedbackTopicsListResponseSchema.parse(raw);
  },

  async getTopic(
    id: string,
    params: GetTopicParams = {},
  ): Promise<FeedbackTopicDetailApi> {
    const qs = buildQuery({ window: params.window });
    const raw = await apiClient.get<unknown>(
      `/api/v1/admin/feedback/topics/${encodeURIComponent(id)}${qs}`,
    );
    return FeedbackTopicDetailSchema.parse(raw);
  },

  async listItems(
    topicId: string,
    params: ListItemsParams = {},
  ): Promise<FeedbackItemsListApi> {
    const qs = buildQuery({
      page: params.page,
      pageSize: params.pageSize,
      groupByUser:
        params.groupByUser === undefined
          ? undefined
          : params.groupByUser
            ? 'true'
            : 'false',
    });
    const raw = await apiClient.get<unknown>(
      `/api/v1/admin/feedback/topics/${encodeURIComponent(topicId)}/items${qs}`,
    );
    return FeedbackItemsListResponseSchema.parse(raw);
  },

  async getItemMessage(
    topicId: string,
    itemId: string,
  ): Promise<FeedbackItemMessageApi> {
    const raw = await apiClient.get<unknown>(
      `/api/v1/admin/feedback/topics/${encodeURIComponent(topicId)}/items/${encodeURIComponent(
        itemId,
      )}/message`,
    );
    return FeedbackItemMessageResponseSchema.parse(raw);
  },

  async runDigest(): Promise<DigestRunResponseApi> {
    const raw = await apiClient.post<unknown>('/api/v1/admin/feedback/digest/run');
    return DigestRunResponseSchema.parse(raw);
  },

  async listFailedMessages(
    params: { page?: number; pageSize?: number } = {},
  ): Promise<FeedbackFailedMessagesListApi> {
    const qs = buildQuery({
      page: params.page,
      pageSize: params.pageSize,
    });
    const raw = await apiClient.get<unknown>(
      `/api/v1/admin/feedback/messages/failed${qs}`,
    );
    return FeedbackFailedMessagesListResponseSchema.parse(raw);
  },

  // Phase 8 mutations — оставлены готовыми клиентами, UI пока их не вызывает.

  async renameTopic(
    id: string,
    body: RenameTopicBody,
  ): Promise<FeedbackTopicDetailApi> {
    const raw = await apiClient.patch<unknown>(
      `/api/v1/admin/feedback/topics/${encodeURIComponent(id)}`,
      body,
    );
    return FeedbackTopicDetailSchema.parse(raw);
  },

  async mergeTopics(
    sourceId: string,
    body: MergeTopicsBody,
  ): Promise<MergeTopicsResultApi> {
    return apiClient.post<MergeTopicsResultApi>(
      `/api/v1/admin/feedback/topics/${encodeURIComponent(sourceId)}/merge`,
      body,
    );
  },

  async archiveTopic(id: string): Promise<FeedbackTopicDetailApi> {
    const raw = await apiClient.post<unknown>(
      `/api/v1/admin/feedback/topics/${encodeURIComponent(id)}/archive`,
    );
    return FeedbackTopicDetailSchema.parse(raw);
  },

  async unarchiveTopic(id: string): Promise<FeedbackTopicDetailApi> {
    const raw = await apiClient.post<unknown>(
      `/api/v1/admin/feedback/topics/${encodeURIComponent(id)}/unarchive`,
    );
    return FeedbackTopicDetailSchema.parse(raw);
  },
};
