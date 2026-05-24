import type { FeedItemDto } from './activity-feed.dto';

/**
 * Контракт WebSocket-событий ленты активности (namespace `/ws/feed`).
 *
 * Sub-ТЗ: plans/tz/2026-05-23-activity-feeds.md §"WebSocket events".
 *
 * Сообщения летят как минимум в room `tenant:${tenantId}`. Дополнительно
 * клиент может подписаться на `team:${teamId}` / `user:${userId}` (личные
 * входящие probe-вопросы). Имя WS event'а = `type`.
 */

export type FeedWsEventType =
  | 'feed.new_item'
  | 'feed.item_updated'
  | 'feed.item_expired'
  | 'feed.item_dismissed';

interface BaseFeedWsEvent<T extends FeedWsEventType> {
  type: T;
  tenantId: string;
  /** ISO 8601 момент эмиссии (серверное время). */
  timestamp: string;
}

export interface FeedNewItemEvent extends BaseFeedWsEvent<'feed.new_item'> {
  item: FeedItemDto;
}

export interface FeedItemUpdatedEvent
  extends BaseFeedWsEvent<'feed.item_updated'> {
  item: FeedItemDto;
  /** Какие поля изменились (для тонкого diff'а на UI). */
  changedFields: string[];
}

export interface FeedItemExpiredEvent
  extends BaseFeedWsEvent<'feed.item_expired'> {
  itemId: string;
  feedType: string;
}

export interface FeedItemDismissedEvent
  extends BaseFeedWsEvent<'feed.item_dismissed'> {
  itemId: string;
  dismissedByUserId: string;
}

export type FeedWsEvent =
  | FeedNewItemEvent
  | FeedItemUpdatedEvent
  | FeedItemExpiredEvent
  | FeedItemDismissedEvent;
