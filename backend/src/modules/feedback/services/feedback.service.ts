/**
 * FeedbackService — пользовательская сторона канала «Ваши предложения»:
 *   - submit:   сохраняет FeedbackMessage, проверяет rate-limit;
 *   - listMine: страница истории сообщений текущего пользователя;
 *   - getLimit: usedToday / limit / resetAt для UI-индикатора.
 *
 * Каркас — Фаза 1: только сигнатуры + DI. Реализация — Фаза 2.
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

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  /**
   * Принимает текст обратной связи от пользователя. Создаёт FeedbackMessage
   * (processedAt=null, failedRuns=0) и инкрементит rate-limit ключ в Redis.
   * Возвращает только что созданное сообщение.
   *
   * Реализация — Фаза 2.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async submit(
    _userId: string,
    _orgId: string | null,
    _text: string,
  ): Promise<FeedbackMessage> {
    throw new Error('FeedbackService.submit not implemented (фаза 2)');
  }

  /**
   * История сообщений пользователя с пагинацией, сортировка по createdAt desc.
   *
   * Реализация — Фаза 2.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async listMine(
    _userId: string,
    _page: number,
    _pageSize: number,
  ): Promise<FeedbackMessagesListResponse> {
    throw new Error('FeedbackService.listMine not implemented (фаза 2)');
  }

  /**
   * Возвращает usedToday / limit / resetAt для индикатора в UI.
   * Берёт счётчик из Redis (ключ `feedback:ratelimit:{userId}:{YYYY-MM-DD-UTC}`).
   *
   * Реализация — Фаза 2.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getLimit(_userId: string): Promise<FeedbackLimitResponse> {
    throw new Error('FeedbackService.getLimit not implemented (фаза 2)');
  }
}
