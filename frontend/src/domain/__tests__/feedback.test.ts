import { describe, expect, it } from 'vitest';

import {
  toFeedbackLimit,
  toFeedbackMessage,
  toFeedbackMessagesList,
} from '../feedback';
import type {
  FeedbackLimitApi,
  FeedbackMessageApi,
  FeedbackMessagesListApi,
} from '@/api/feedback.api';

describe('feedback domain mappers', () => {
  const baseMessage: FeedbackMessageApi = {
    id: 'fbm_1',
    text: 'Нужна тёмная тема',
    createdAt: '2026-05-25T10:30:00.000Z',
    processedAt: null,
  };

  describe('toFeedbackMessage', () => {
    it('преобразует createdAt в Date', () => {
      const out = toFeedbackMessage(baseMessage);
      expect(out.createdAt).toBeInstanceOf(Date);
      expect(out.createdAt.toISOString()).toBe('2026-05-25T10:30:00.000Z');
    });

    it('processed=false когда processedAt=null', () => {
      const out = toFeedbackMessage(baseMessage);
      expect(out.processed).toBe(false);
    });

    it('processed=true когда processedAt задан', () => {
      const out = toFeedbackMessage({
        ...baseMessage,
        processedAt: '2026-05-26T01:00:00.000Z',
      });
      expect(out.processed).toBe(true);
    });

    it('пробрасывает id и text без изменений', () => {
      const out = toFeedbackMessage(baseMessage);
      expect(out.id).toBe('fbm_1');
      expect(out.text).toBe('Нужна тёмная тема');
    });

    it('пока всегда возвращает status="received"', () => {
      const out = toFeedbackMessage(baseMessage);
      expect(out.status).toBe('received');
    });
  });

  describe('toFeedbackMessagesList', () => {
    it('маппит каждое сообщение и сохраняет пагинацию', () => {
      const dto: FeedbackMessagesListApi = {
        items: [baseMessage, { ...baseMessage, id: 'fbm_2' }],
        total: 42,
        page: 2,
        pageSize: 20,
      };
      const out = toFeedbackMessagesList(dto);
      expect(out.items).toHaveLength(2);
      expect(out.items[0]?.id).toBe('fbm_1');
      expect(out.items[1]?.id).toBe('fbm_2');
      expect(out.items[0]?.createdAt).toBeInstanceOf(Date);
      expect(out.total).toBe(42);
      expect(out.page).toBe(2);
      expect(out.pageSize).toBe(20);
    });

    it('возвращает пустой список без падения', () => {
      const out = toFeedbackMessagesList({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
      });
      expect(out.items).toEqual([]);
      expect(out.total).toBe(0);
    });
  });

  describe('toFeedbackLimit', () => {
    it('преобразует resetAt в Date и сохраняет счётчик', () => {
      const dto: FeedbackLimitApi = {
        usedToday: 3,
        limit: 5,
        resetAt: '2026-05-26T00:00:00.000Z',
      };
      const out = toFeedbackLimit(dto);
      expect(out.usedToday).toBe(3);
      expect(out.limit).toBe(5);
      expect(out.resetAt).toBeInstanceOf(Date);
      expect(out.resetAt.toISOString()).toBe('2026-05-26T00:00:00.000Z');
    });
  });
});
