/**
 * DomainModel канала «Ваши предложения».
 *
 * Слой ApiDto → DomainModel: компонент работает только с FeedbackMessage
 * и FeedbackLimit (Date-объекты, готовые для форматирования).
 *
 * Фаза 3 ТЗ user-feedback-with-ai-clustering.
 *
 * Поле `status` оставлено расширяемым: в Фазе 2 продукта планируется
 * показывать пользователю «получено / учтено / в работе / отклонено».
 * Пока маппер всегда возвращает `'received'`.
 */

import type {
  FeedbackLimitApi,
  FeedbackMessageApi,
  FeedbackMessagesListApi,
} from '../api/feedback.api';

export type FeedbackStatus = 'received';

export interface FeedbackMessage {
  id: string;
  text: string;
  createdAt: Date;
  processed: boolean;
  status: FeedbackStatus;
}

export interface FeedbackMessagesList {
  items: FeedbackMessage[];
  total: number;
  page: number;
  pageSize: number;
}

export interface FeedbackLimit {
  usedToday: number;
  limit: number;
  resetAt: Date;
}

export function toFeedbackMessage(dto: FeedbackMessageApi): FeedbackMessage {
  return {
    id: dto.id,
    text: dto.text,
    createdAt: new Date(dto.createdAt),
    processed: dto.processedAt !== null,
    status: 'received',
  };
}

export function toFeedbackMessagesList(
  dto: FeedbackMessagesListApi,
): FeedbackMessagesList {
  return {
    items: dto.items.map(toFeedbackMessage),
    total: dto.total,
    page: dto.page,
    pageSize: dto.pageSize,
  };
}

export function toFeedbackLimit(dto: FeedbackLimitApi): FeedbackLimit {
  return {
    usedToday: dto.usedToday,
    limit: dto.limit,
    resetAt: new Date(dto.resetAt),
  };
}
