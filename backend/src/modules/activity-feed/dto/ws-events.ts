import type { FeedItemDto } from './activity-feed.dto';

export type FeedWsEventType =
  | 'feed.new_item'
  | 'feed.item_updated'
  | 'feed.item_expired'
  | 'feed.item_dismissed';

interface BaseFeedWsEvent<T extends FeedWsEventType> {
  type: T;
  tenantId: string;
  timestamp: string;
}

export interface FeedNewItemEvent extends BaseFeedWsEvent<'feed.new_item'> {
  item: FeedItemDto;
}

export interface FeedItemUpdatedEvent extends BaseFeedWsEvent<'feed.item_updated'> {
  item: FeedItemDto;
  changedFields: string[];
}

export interface FeedItemExpiredEvent extends BaseFeedWsEvent<'feed.item_expired'> {
  itemId: string;
  feedType: string;
}

export interface FeedItemDismissedEvent extends BaseFeedWsEvent<'feed.item_dismissed'> {
  itemId: string;
  dismissedByUserId: string;
}

export type FeedWsEvent =
  | FeedNewItemEvent
  | FeedItemUpdatedEvent
  | FeedItemExpiredEvent
  | FeedItemDismissedEvent;
