/**
 * Domain types для ActivityFeed (Pulse §1.8 — ActivityFeedWidget).
 *
 * Зеркалирует подмножество `FeedItemDto` из
 * `backend/src/modules/activity-feed/dto/activity-feed.dto.ts` —
 * только поля, которые нужны виджету на дашборде / probe-каналам.
 *
 * Backend хранит enum'ы как строки (sub-ТЗ activity-feeds §"Модель данных"),
 * поэтому здесь — обычные union'ы.
 */

export type FeedType =
  | 'probe_question'
  | 'insight'
  | 'decision'
  | 'task'
  | 'idea'
  | 'conflict'
  | 'knowledge_change'
  | 'recognition';

export type FeedSeverity = 'critical' | 'high' | 'normal' | 'low';

export type FeedStatus =
  | 'emitted'
  | 'delivered'
  | 'seen'
  | 'responded'
  | 'actioned'
  | 'dismissed'
  | 'expired';

/** То, что реально приходит от `GET /api/v1/feed/:type` (подмножество). */
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
