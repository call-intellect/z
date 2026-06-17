export type FeedType =
  | "probe_question"
  | "insight"
  | "decision"
  | "task"
  | "idea"
  | "conflict"
  | "knowledge_change"
  | "recognition";

export type FeedSeverity = "critical" | "high" | "normal" | "low";

export type FeedStatus =
  | "emitted"
  | "delivered"
  | "seen"
  | "responded"
  | "actioned"
  | "dismissed"
  | "expired";

export type FeedItemApi = {
  id: string;
  feedType: FeedType;
  title: string;
  summary: string | null;
  severity: FeedSeverity;
  status: FeedStatus;
  emittedAt: string;
  respondedAt: string | null;
};

export type FeedListApi = {
  items: FeedItemApi[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export type FeedItemDomain = FeedItemApi & { emittedAtDate: Date };

export function feedItemFromApi(api: FeedItemApi): FeedItemDomain {
  return { ...api, emittedAtDate: new Date(api.emittedAt) };
}
