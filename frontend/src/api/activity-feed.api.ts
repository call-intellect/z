import { apiClient } from "./api-client";
import type { FeedListApi, FeedStatus, FeedType } from "@/domain/activity-feed";

export const activityFeedApi = {
  list: (args: {
    feedType: FeedType;
    status?: FeedStatus;
    limit?: number;
    page?: number;
    scopedToMe?: boolean;
    teamId?: string;
    viewedUserId?: string;
  }) => {
    const params = new URLSearchParams();
    if (args.status) params.set("status", args.status);
    if (args.limit !== undefined) params.set("limit", String(args.limit));
    if (args.page !== undefined) params.set("page", String(args.page));
    params.set("scopedToMe", String(args.scopedToMe ?? false));
    if (args.teamId) params.set("teamId", args.teamId);
    if (args.viewedUserId) params.set("viewedUserId", args.viewedUserId);
    const query = params.toString();
    return apiClient.get<FeedListApi>(
      `/api/v1/feed/${encodeURIComponent(args.feedType)}${query ? `?${query}` : ""}`,
    );
  },
};
