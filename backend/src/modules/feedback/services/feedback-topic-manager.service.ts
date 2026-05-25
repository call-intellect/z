/**
 * FeedbackTopicManagerService — операции super-admin'а над блоками:
 *   - listTopics:   агрегированный список с метриками за окно;
 *   - getTopic:     детали блока;
 *   - listItems:    items блока с информацией об авторе и Org;
 *   - getItemMessage: исходное FeedbackMessage по item.id;
 *   - rename:       PATCH title + description;
 *   - merge:        перенос items source → target в транзакции;
 *   - archive / unarchive: переключение status.
 *
 * Каркас — Фаза 1. Реализация — Фаза 6.
 *
 * Источник: plans/tz/2026-05-25-user-feedback-with-ai-clustering.md
 * раздел «Админские эндпоинты».
 */

import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  FeedbackItemMessageResponse,
  FeedbackItemsListResponse,
} from '../dto/feedback-item.dto';
import type { MergeTopicsBody } from '../dto/merge-topics.dto';
import type { RenameTopicBody } from '../dto/rename-topic.dto';
import type { TopicListFilters } from '../dto/topic-list-filters.dto';
import type {
  FeedbackTopicDetail,
  FeedbackTopicsListResponse,
} from '../dto/feedback-topic.dto';

@Injectable()
export class FeedbackTopicManagerService {
  private readonly logger = new Logger(FeedbackTopicManagerService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async listTopics(
    _filters: TopicListFilters,
  ): Promise<FeedbackTopicsListResponse> {
    throw new Error(
      'FeedbackTopicManagerService.listTopics not implemented (фаза 6)',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getTopic(
    _id: string,
    _window: TopicListFilters['window'],
  ): Promise<FeedbackTopicDetail> {
    throw new Error(
      'FeedbackTopicManagerService.getTopic not implemented (фаза 6)',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async listItems(
    _topicId: string,
    _page: number,
    _pageSize: number,
  ): Promise<FeedbackItemsListResponse> {
    throw new Error(
      'FeedbackTopicManagerService.listItems not implemented (фаза 6)',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getItemMessage(
    _topicId: string,
    _itemId: string,
  ): Promise<FeedbackItemMessageResponse> {
    throw new Error(
      'FeedbackTopicManagerService.getItemMessage not implemented (фаза 6)',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async rename(_id: string, _body: RenameTopicBody): Promise<FeedbackTopicDetail> {
    throw new Error(
      'FeedbackTopicManagerService.rename not implemented (фаза 6)',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async merge(
    _sourceId: string,
    _body: MergeTopicsBody,
  ): Promise<{ movedItems: number; mergedIntoId: string }> {
    throw new Error(
      'FeedbackTopicManagerService.merge not implemented (фаза 6)',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async archive(_id: string): Promise<FeedbackTopicDetail> {
    throw new Error(
      'FeedbackTopicManagerService.archive not implemented (фаза 6)',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async unarchive(_id: string): Promise<FeedbackTopicDetail> {
    throw new Error(
      'FeedbackTopicManagerService.unarchive not implemented (фаза 6)',
    );
  }

  /**
   * Список FeedbackMessage с failedRuns >= 3 — для ручного разбора.
   * Используется в `GET /admin/feedback/messages/failed`.
   */
  async listFailedMessages(): Promise<{
    items: Array<{
      id: string;
      text: string;
      createdAt: string;
      failedRuns: number;
      userId: string;
    }>;
  }> {
    throw new Error(
      'FeedbackTopicManagerService.listFailedMessages not implemented (фаза 6)',
    );
  }
}
