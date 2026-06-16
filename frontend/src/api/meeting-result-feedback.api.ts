import { apiClient } from "./api-client";

export type FeedbackReactionApi = "positive" | "negative";

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
  async getOwn(meetingId: string): Promise<AiResultFeedbackApi | null> {
    const res = await apiClient.get<{ feedback: AiResultFeedbackApi | null }>(
      `/api/v1/meetings/${meetingId}/result/feedback/me`,
    );
    return res.feedback;
  },

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

  async remove(meetingId: string): Promise<{ ok: true }> {
    return apiClient.del<{ ok: true }>(
      `/api/v1/meetings/${meetingId}/result/feedback/me`,
    );
  },
};
