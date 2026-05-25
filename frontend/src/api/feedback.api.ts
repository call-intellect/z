/**
 * Feedback API — пользовательский канал «Ваши предложения».
 *
 * Эндпоинты (см. backend/src/modules/feedback/controllers/feedback-user.controller.ts):
 *   - POST /api/v1/feedback           — отправка (rate-limit 5/сутки UTC)
 *   - GET  /api/v1/feedback/my        — история своих сообщений (пагинация)
 *   - GET  /api/v1/feedback/my/limit  — usedToday / limit / resetAt
 *
 * Защита: CookieAuthGuard на backend; здесь только тонкие обёртки над
 * единым `apiClient`. Фаза 3 ТЗ user-feedback-with-ai-clustering.
 */

import { apiClient } from './api-client';
import { buildQuery } from './admin-helpers';

export interface FeedbackMessageApi {
  id: string;
  text: string;
  createdAt: string;
  processedAt: string | null;
}

export interface FeedbackMessagesListApi {
  items: FeedbackMessageApi[];
  total: number;
  page: number;
  pageSize: number;
}

export interface FeedbackLimitApi {
  usedToday: number;
  limit: number;
  resetAt: string;
}

export interface SubmitFeedbackBody {
  text: string;
}

export const feedbackApi = {
  submit: (body: SubmitFeedbackBody) =>
    apiClient.post<FeedbackMessageApi>('/api/v1/feedback', body),

  listMine: (params: { page?: number; pageSize?: number } = {}) => {
    const qs = buildQuery({
      page: params.page,
      pageSize: params.pageSize,
    });
    return apiClient.get<FeedbackMessagesListApi>(`/api/v1/feedback/my${qs}`);
  },

  getMyLimit: () =>
    apiClient.get<FeedbackLimitApi>('/api/v1/feedback/my/limit'),
};
