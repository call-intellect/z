/**
 * Фаза A.3 — API-обёртки для feedback пользователя на AI-результат встречи.
 *
 *   POST /api/v1/meetings/:meetingId/result/feedback
 *   GET  /api/v1/meetings/:meetingId/result/feedback/me
 *   DELETE /api/v1/meetings/:meetingId/result/feedback/me
 */

import { apiClient } from './api-client';

export type FeedbackReactionApi = 'positive' | 'negative';

export interface AiResultFeedbackApi {
  id: string;
  aiResultId: string;
  userId: string;
  reaction: FeedbackReactionApi;
  comment: string | null;
  createdAt: string;
}

export interface FeedbackCreatePayload {
  reaction: FeedbackReactionApi;
  comment?: string | null;
}

export const meetingResultFeedbackApi = {
  /** Получить собственную реакцию (или null если ещё не оставлял). */
  async getOwn(meetingId: string): Promise<AiResultFeedbackApi | null> {
    const res = await apiClient.get<{ feedback: AiResultFeedbackApi | null }>(
      `/api/v1/meetings/${meetingId}/result/feedback/me`,
    );
    return res.feedback;
  },

  /** Поставить (или обновить) реакцию. */
  async create(
    meetingId: string,
    payload: FeedbackCreatePayload,
  ): Promise<AiResultFeedbackApi> {
    const res = await apiClient.post<{ feedback: AiResultFeedbackApi }>(
      `/api/v1/meetings/${meetingId}/result/feedback`,
      payload,
    );
    return res.feedback;
  },

  /** Удалить свою реакцию. */
  async remove(meetingId: string): Promise<{ ok: true }> {
    return apiClient.del<{ ok: true }>(
      `/api/v1/meetings/${meetingId}/result/feedback/me`,
    );
  },
};
