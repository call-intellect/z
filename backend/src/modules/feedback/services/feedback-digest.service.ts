/**
 * FeedbackDigestService — ночной AI-прогон по обратной связи.
 *
 * Алгоритм (см. ТЗ § Сервис feedback-digest.service.ts):
 *   1. Собрать FeedbackMessage с processedAt=null AND failedRuns<3.
 *   2. Загрузить все ACTIVE FeedbackTopic.
 *   3. Вызвать LLM (DeepSeek V4 Pro → fallback chain через LlmRouterService).
 *   4. Zod-валидация ответа + sanity-check.
 *   5. Транзакционно: создать новые topics + items + processedAt=NOW.
 *
 * Также экспонируется ручной enqueue из admin-эндпоинта
 * `POST /admin/feedback/digest/run`.
 *
 * Каркас — Фаза 1: пустые сигнатуры. Логика — Фаза 5.
 *
 * Источник: plans/tz/2026-05-25-user-feedback-with-ai-clustering.md.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';

/**
 * Результат одного прогона. Поля заполняются логикой Фазы 5.
 */
export interface DigestResult {
  skipped: boolean;
  processed: number;
  newTopics: number;
}

@Injectable()
export class FeedbackDigestService {
  private readonly logger = new Logger(FeedbackDigestService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  /**
   * Запустить один прогон digest'а. Используется и из cron'а, и из ручного
   * `POST /admin/feedback/digest/run`. Идемпотентность гарантируется
   * Redis-локом `feedback:digest:lock` (TTL 30 минут).
   *
   * Реализация — Фаза 5.
   */
  async runDigest(): Promise<DigestResult> {
    throw new Error('FeedbackDigestService.runDigest not implemented (фаза 5)');
  }

  /**
   * Поставить job в BullMQ-очередь `feedback-digest` для ручного запуска
   * из admin-UI. Сам processor (Фаза 5) внутренне зовёт runDigest().
   *
   * Реализация — Фаза 5.
   */
  async enqueueManualRun(): Promise<{ jobId: string }> {
    throw new Error(
      'FeedbackDigestService.enqueueManualRun not implemented (фаза 5)',
    );
  }
}
