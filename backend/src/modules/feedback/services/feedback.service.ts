/**
 * FeedbackService — пользовательская сторона канала «Ваши предложения»:
 *   - submit:   сохраняет FeedbackMessage в БД (rate-limit уже посчитан guard'ом);
 *   - listMine: страница истории сообщений текущего пользователя;
 *   - getLimit: usedToday / limit / resetAt для UI-индикатора.
 *
 * Источник: plans/tz/2026-05-25-user-feedback-with-ai-clustering.md
 * раздел «Пользовательские эндпоинты».
 */

import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import type {
  FeedbackLimitResponse,
  FeedbackMessage,
  FeedbackMessagesListResponse,
} from '../dto/feedback-message.dto';
import {
  FEEDBACK_DAILY_LIMIT,
  feedbackRateLimitKey,
} from '../guards/feedback-rate-limit.guard';

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  /**
   * Принимает текст обратной связи от пользователя. Создаёт FeedbackMessage
   * (processedAt=null, failedRuns=0). Rate-limit уже проверен и инкрементирован
   * FeedbackRateLimitGuard'ом — здесь повторно не считаем.
   *
   * Возвращает только что созданное сообщение в форме FeedbackMessage DTO.
   */
  async submit(
    userId: string,
    orgId: string | null,
    text: string,
  ): Promise<FeedbackMessage> {
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

  /**
   * История сообщений пользователя с пагинацией. Сортировка по createdAt desc
   * (новые сверху). Возвращает items + total + page + pageSize для UI.
   */
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

  /**
   * Сколько сообщений отправлено сегодня (UTC) и когда счётчик обнулится.
   * Читает Redis-ключ `feedback:ratelimit:{userId}:{YYYY-MM-DD-UTC}` через GET
   * (без INCR — это read-only операция для UI).
   */
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
}

/**
 * Возвращает ближайшую полночь UTC после указанного момента.
 * Используется для resetAt в /feedback/my/limit.
 */
function nextUtcMidnight(now: Date): Date {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0,
      0,
    ),
  );
}
