import { describe, expect, it } from 'vitest';

import {
  formatAuthor,
  toFeedbackFailedMessage,
  toFeedbackFailedMessagesList,
  toFeedbackItem,
  toFeedbackItemMessage,
  toFeedbackItemsList,
  toFeedbackTopicDetail,
  toFeedbackTopicSummary,
  toFeedbackTopicsList,
} from '../admin-feedback';
import type {
  FeedbackFailedMessageApi,
  FeedbackFailedMessagesListApi,
  FeedbackItemApi,
  FeedbackItemMessageApi,
  FeedbackItemsListApi,
  FeedbackTopicDetailApi,
  FeedbackTopicSummaryApi,
  FeedbackTopicsListApi,
} from '@/api/admin-feedback.api';

describe('admin-feedback domain mappers', () => {
  const summaryDto: FeedbackTopicSummaryApi = {
    id: 'ftp_1',
    title: 'Хочу тёмную тему',
    description: 'Несколько юзеров просят тёмную тему',
    status: 'ACTIVE',
    itemsCount: 12,
    uniqueUsersCount: 7,
    percentOfWindow: 14.5,
    lastItemAt: '2026-05-24T12:00:00.000Z',
    createdAt: '2026-05-01T10:00:00.000Z',
  };

  describe('toFeedbackTopicSummary', () => {
    it('нормализует статус ACTIVE → active', () => {
      const out = toFeedbackTopicSummary(summaryDto);
      expect(out.status).toBe('active');
    });

    it('нормализует ARCHIVED → archived', () => {
      const out = toFeedbackTopicSummary({ ...summaryDto, status: 'ARCHIVED' });
      expect(out.status).toBe('archived');
    });

    it('нормализует MERGED → merged', () => {
      const out = toFeedbackTopicSummary({ ...summaryDto, status: 'MERGED' });
      expect(out.status).toBe('merged');
    });

    it('преобразует createdAt и lastItemAt в Date', () => {
      const out = toFeedbackTopicSummary(summaryDto);
      expect(out.createdAt).toBeInstanceOf(Date);
      expect(out.lastItemAt).toBeInstanceOf(Date);
      expect(out.lastItemAt?.toISOString()).toBe('2026-05-24T12:00:00.000Z');
    });

    it('lastItemAt=null когда в API null', () => {
      const out = toFeedbackTopicSummary({ ...summaryDto, lastItemAt: null });
      expect(out.lastItemAt).toBeNull();
    });

    it('сохраняет численные метрики без изменений', () => {
      const out = toFeedbackTopicSummary(summaryDto);
      expect(out.itemsCount).toBe(12);
      expect(out.uniqueUsersCount).toBe(7);
      expect(out.percentOfWindow).toBe(14.5);
    });
  });

  describe('toFeedbackTopicsList', () => {
    it('маппит каждый блок и сохраняет агрегаты окна', () => {
      const dto: FeedbackTopicsListApi = {
        items: [summaryDto, { ...summaryDto, id: 'ftp_2' }],
        totalItemsInWindow: 80,
        totalUsersInWindow: 25,
        totalTopicsInWindow: 12,
        page: 2,
        pageSize: 20,
      };
      const out = toFeedbackTopicsList(dto);
      expect(out.items).toHaveLength(2);
      expect(out.items[0]?.id).toBe('ftp_1');
      expect(out.items[1]?.id).toBe('ftp_2');
      expect(out.totalItemsInWindow).toBe(80);
      expect(out.totalUsersInWindow).toBe(25);
      expect(out.totalTopicsInWindow).toBe(12);
      expect(out.page).toBe(2);
      expect(out.pageSize).toBe(20);
    });

    it('возвращает пустой список без падения', () => {
      const out = toFeedbackTopicsList({
        items: [],
        totalItemsInWindow: 0,
        totalUsersInWindow: 0,
        totalTopicsInWindow: 0,
        page: 1,
        pageSize: 20,
      });
      expect(out.items).toEqual([]);
      expect(out.totalItemsInWindow).toBe(0);
    });
  });

  describe('toFeedbackTopicDetail', () => {
    const detailDto: FeedbackTopicDetailApi = {
      ...summaryDto,
      archivedAt: '2026-05-20T10:00:00.000Z',
      updatedAt: '2026-05-25T11:00:00.000Z',
      mergedIntoId: 'ftp_target',
    };

    it('расширяет summary полями деталей', () => {
      const out = toFeedbackTopicDetail(detailDto);
      expect(out.id).toBe('ftp_1');
      expect(out.status).toBe('active');
      expect(out.archivedAt).toBeInstanceOf(Date);
      expect(out.updatedAt).toBeInstanceOf(Date);
      expect(out.mergedIntoId).toBe('ftp_target');
    });

    it('archivedAt=null когда в API null', () => {
      const out = toFeedbackTopicDetail({ ...detailDto, archivedAt: null });
      expect(out.archivedAt).toBeNull();
    });
  });

  describe('toFeedbackItem', () => {
    const itemDto: FeedbackItemApi = {
      id: 'fbi_1',
      text: 'Нужна тёмная тема в админке',
      createdAt: '2026-05-24T10:00:00.000Z',
      messageId: 'fbm_42',
      user: { id: 'usr_1', email: 'foo@bar.ru', name: 'Иван' },
      org: { id: 'org_1', name: 'Acme' },
      discarded: false,
      discardReason: null,
    };

    it('преобразует createdAt в Date и сохраняет messageId', () => {
      const out = toFeedbackItem(itemDto);
      expect(out.createdAt).toBeInstanceOf(Date);
      expect(out.messageId).toBe('fbm_42');
    });

    it('org=null когда в API null', () => {
      const out = toFeedbackItem({ ...itemDto, org: null });
      expect(out.org).toBeNull();
    });

    it('передаёт user.name=null прозрачно', () => {
      const out = toFeedbackItem({
        ...itemDto,
        user: { ...itemDto.user, name: null },
      });
      expect(out.user.name).toBeNull();
    });

    it('сохраняет discarded и причину', () => {
      const out = toFeedbackItem({
        ...itemDto,
        discarded: true,
        discardReason: 'Не относится к фидбэку',
      });
      expect(out.discarded).toBe(true);
      expect(out.discardReason).toBe('Не относится к фидбэку');
    });
  });

  describe('toFeedbackItemsList', () => {
    it('маппит items и пагинацию', () => {
      const dto: FeedbackItemsListApi = {
        items: [
          {
            id: 'fbi_1',
            text: 'A',
            createdAt: '2026-05-24T10:00:00.000Z',
            messageId: 'fbm_1',
            user: { id: 'u1', email: 'a@b.c', name: null },
            org: null,
            discarded: false,
            discardReason: null,
          },
        ],
        total: 10,
        page: 1,
        pageSize: 50,
      };
      const out = toFeedbackItemsList(dto);
      expect(out.items).toHaveLength(1);
      expect(out.total).toBe(10);
      expect(out.items[0]?.createdAt).toBeInstanceOf(Date);
    });
  });

  describe('toFeedbackItemMessage', () => {
    it('возвращает Date для createdAt + сохраняет userId/orgId', () => {
      const dto: FeedbackItemMessageApi = {
        id: 'fbm_1',
        text: 'Полный текст обращения',
        createdAt: '2026-05-24T09:30:00.000Z',
        userId: 'usr_5',
        orgId: 'org_3',
        user: { id: 'usr_5', email: 'x@y.z', name: 'Петя' },
        org: { id: 'org_3', name: 'Beta' },
      };
      const out = toFeedbackItemMessage(dto);
      expect(out.createdAt).toBeInstanceOf(Date);
      expect(out.userId).toBe('usr_5');
      expect(out.orgId).toBe('org_3');
      expect(out.org?.name).toBe('Beta');
    });

    it('orgId=null допустим', () => {
      const dto: FeedbackItemMessageApi = {
        id: 'fbm_1',
        text: 'x',
        createdAt: '2026-05-24T09:30:00.000Z',
        userId: 'usr_5',
        orgId: null,
        user: { id: 'usr_5', email: 'x@y.z', name: null },
        org: null,
      };
      const out = toFeedbackItemMessage(dto);
      expect(out.orgId).toBeNull();
      expect(out.org).toBeNull();
    });
  });

  describe('toFeedbackFailedMessage', () => {
    it('преобразует createdAt в Date', () => {
      const dto: FeedbackFailedMessageApi = {
        id: 'fbm_x',
        userId: 'usr_x',
        userEmail: 'x@y.z',
        text: 'Текст',
        createdAt: '2026-05-20T10:00:00.000Z',
        failedRuns: 3,
      };
      const out = toFeedbackFailedMessage(dto);
      expect(out.createdAt).toBeInstanceOf(Date);
      expect(out.failedRuns).toBe(3);
    });
  });

  describe('toFeedbackFailedMessagesList', () => {
    it('маппит каждый элемент', () => {
      const dto: FeedbackFailedMessagesListApi = {
        items: [
          {
            id: 'fbm_x',
            userId: 'usr_x',
            userEmail: 'x@y.z',
            text: 'A',
            createdAt: '2026-05-20T10:00:00.000Z',
            failedRuns: 3,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      };
      const out = toFeedbackFailedMessagesList(dto);
      expect(out.items).toHaveLength(1);
      expect(out.total).toBe(1);
    });
  });

  describe('formatAuthor', () => {
    it('возвращает "name · email" если имя есть', () => {
      expect(
        formatAuthor({ id: 'u', email: 'a@b.c', name: 'Иван' }),
      ).toBe('Иван · a@b.c');
    });

    it('возвращает только email если name=null', () => {
      expect(formatAuthor({ id: 'u', email: 'a@b.c', name: null })).toBe(
        'a@b.c',
      );
    });

    it('возвращает только email если name пустая строка', () => {
      expect(formatAuthor({ id: 'u', email: 'a@b.c', name: '   ' })).toBe(
        'a@b.c',
      );
    });
  });
});
