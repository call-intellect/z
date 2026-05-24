/**
 * API-клиент модуля tracker.comments.
 *
 * Контракт: `backend/src/modules/tracker/controllers/comments.controller.ts`.
 */

import { apiClient } from '../api-client';
import { orgHeaders } from '../admin-helpers';
import type { CommentApi, CommentAccess } from '@/domain/tracker';

export interface CreateCommentRequest {
  content: string;
  contentHtml?: string | null;
  contentStripped?: string | null;
  parentCommentId?: string | null;
  access?: CommentAccess;
  voiceUrl?: string | null;
  voiceDuration?: number | null;
  voiceTranscript?: string | null;
}

export interface UpdateCommentRequest {
  content: string;
  contentHtml?: string | null;
  contentStripped?: string | null;
}

export const commentsApi = {
  listByIssue: (orgId: string, issueId: string) =>
    apiClient.get<CommentApi[]>(
      `/api/v1/issues/${encodeURIComponent(issueId)}/comments`,
      { headers: orgHeaders(orgId) },
    ),

  create: (orgId: string, issueId: string, body: CreateCommentRequest) =>
    apiClient.post<CommentApi>(
      `/api/v1/issues/${encodeURIComponent(issueId)}/comments`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  update: (orgId: string, commentId: string, body: UpdateCommentRequest) =>
    apiClient.patch<CommentApi>(
      `/api/v1/comments/${encodeURIComponent(commentId)}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  remove: (orgId: string, commentId: string) =>
    apiClient.del<void>(`/api/v1/comments/${encodeURIComponent(commentId)}`, {
      headers: orgHeaders(orgId),
    }),
};
