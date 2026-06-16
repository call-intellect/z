import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import type {
  FeedbackItemMessageResponse,
  FeedbackItemsListResponse,
} from '../dto/feedback-item.dto';
import type {
  FeedbackFailedMessagesListResponse,
  FeedbackLimitResponse,
  FeedbackMessage,
  FeedbackMessagesListResponse,
} from '../dto/feedback-message.dto';
import type { FeedbackTopicDetail, FeedbackTopicsListResponse } from '../dto/feedback-topic.dto';
import type { FeedbackTopicWindow, TopicListFilters } from '../dto/topic-list-filters.dto';
import { FEEDBACK_DAILY_LIMIT, feedbackRateLimitKey } from '../guards/feedback-rate-limit.guard';

import { FeedbackTopicManagerService } from './feedback-topic-manager.service';

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(FeedbackTopicManagerService)
    private readonly topicManager: FeedbackTopicManagerService,
  ) {}

  async submit(userId: string, orgId: string | null, text: string): Promise<FeedbackMessage> {
    const trimmed = text.trim();
    this.logger.log(
      { userId, orgId, length: trimmed.length },
      'feedback.submit: сохраняю сообщение',
    );

    const created = await this.prisma.feedbackMessage.create({
      data: {
        userId,
        orgId,
        text: trimmed,
      },
      select: {
        id: true,
        text: true,
        createdAt: true,
        processedAt: true,
      },
    });

    return {
      id: created.id,
      text: created.text,
      createdAt: created.createdAt.toISOString(),
      processedAt: created.processedAt ? created.processedAt.toISOString() : null,
    };
  }

  async listMine(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<FeedbackMessagesListResponse> {
    const skip = (page - 1) * pageSize;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.feedbackMessage.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          text: true,
          createdAt: true,
          processedAt: true,
        },
      }),
      this.prisma.feedbackMessage.count({ where: { userId } }),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        text: r.text,
        createdAt: r.createdAt.toISOString(),
        processedAt: r.processedAt ? r.processedAt.toISOString() : null,
      })),
      total,
      page,
      pageSize,
    };
  }

  async getLimit(userId: string): Promise<FeedbackLimitResponse> {
    const now = new Date();
    const key = feedbackRateLimitKey(userId, now);

    let usedToday = 0;
    try {
      const raw = await this.redis.client.get(key);
      if (raw !== null && raw !== undefined) {
        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed >= 0) {
          usedToday = Math.floor(parsed);
        }
      }
    } catch (err) {
      this.logger.warn(
        { userId, key, err: err instanceof Error ? err.message : String(err) },
        'feedback.getLimit: Redis недоступен — возвращаю 0',
      );
    }

    return {
      usedToday,
      limit: FEEDBACK_DAILY_LIMIT,
      resetAt: nextUtcMidnight(now).toISOString(),
    };
  }

  async listTopics(filters: TopicListFilters): Promise<FeedbackTopicsListResponse> {
    return this.topicManager.listTopics(filters);
  }

  async getTopicDetails(id: string, window: FeedbackTopicWindow): Promise<FeedbackTopicDetail> {
    return this.topicManager.getTopic(id, window);
  }

  async getTopicItems(
    topicId: string,
    page: number,
    pageSize: number,
  ): Promise<FeedbackItemsListResponse> {
    return this.topicManager.listItems(topicId, page, pageSize);
  }

  async getMessageById(topicId: string, itemId: string): Promise<FeedbackItemMessageResponse> {
    return this.topicManager.getItemMessage(topicId, itemId);
  }

  async listFailedMessages(
    page: number,
    pageSize: number,
  ): Promise<FeedbackFailedMessagesListResponse> {
    const skip = (page - 1) * pageSize;
    const where = {
      failedRuns: { gte: 3 },
      processedAt: null,
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.feedbackMessage.findMany({
        where,
        orderBy: [{ failedRuns: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: pageSize,
        select: {
          id: true,
          userId: true,
          text: true,
          createdAt: true,
          failedRuns: true,
          user: { select: { email: true } },
        },
      }),
      this.prisma.feedbackMessage.count({ where }),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        userEmail: r.user.email,
        text: r.text,
        createdAt: r.createdAt.toISOString(),
        failedRuns: r.failedRuns,
      })),
      total,
      page,
      pageSize,
    };
  }

  async getMessageRawById(id: string): Promise<{
    id: string;
    text: string;
    createdAt: Date;
    userId: string;
    orgId: string | null;
  }> {
    const msg = await this.prisma.feedbackMessage.findUnique({
      where: { id },
      select: {
        id: true,
        text: true,
        createdAt: true,
        userId: true,
        orgId: true,
      },
    });
    if (!msg) {
      throw new NotFoundException(`FeedbackMessage ${id} не найден`);
    }
    return msg;
  }
}

function nextUtcMidnight(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0),
  );
}
