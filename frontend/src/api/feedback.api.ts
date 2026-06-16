import { apiClient } from "./api-client";
import { buildQuery } from "./admin-helpers";

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
    apiClient.post<FeedbackMessageApi>("/api/v1/feedback", body),

  listMine: (params: { page?: number; pageSize?: number } = {}) => {
    const qs = buildQuery({
      page: params.page,
      pageSize: params.pageSize,
    });
    return apiClient.get<FeedbackMessagesListApi>(`/api/v1/feedback/my${qs}`);
  },

  getMyLimit: () =>
    apiClient.get<FeedbackLimitApi>("/api/v1/feedback/my/limit"),
};
