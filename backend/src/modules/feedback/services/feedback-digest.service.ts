/**
 * FeedbackDigestService — ночной AI-прогон по обратной связи.
 *
 * Алгоритм (см. ТЗ §«Сервис feedback-digest.service.ts»):
 *   1. Redis-lock `feedback:digest:lock` (TTL 30 минут, SETNX).
 *   2. Собрать FeedbackMessage с processedAt=null AND failedRuns<3,
 *      orderBy createdAt asc, take = FEEDBACK_DIGEST_BATCH_SIZE.
 *   3. Если пусто — return { skipped: true, processed: 0, newTopics: 0 }.
 *   4. Загрузить все ACTIVE FeedbackTopic (id, title, description).
 *   5. Вызвать LLM через LlmRouterService.call({ taskType: 'feedback.cluster',
 *      ... }). Router сам перебирает primary→secondary→tertiary fallback-цепочку.
 *      На уровне сервиса делаем ДВЕ попытки:
 *        - попытка 1: чистый user-message;
 *        - попытка 2: тот же user-message + retry-инструкция «верни строго
 *          по схеме» (caller-side retry поверх router-side fallback).
 *   6. Валидация ответа: JSON.parse → FeedbackClusterOutputSchema.parse →
 *      validateFeedbackClusterReferences.
 *   7. Sanity-check: newTopics.length > 0.5 * total_items → аномалия, throw.
 *   8. Транзакция Prisma:
 *      8a. Создать newTopics, собрать map tempId→realId.
 *      8b. Создать FeedbackItem на каждый assignment.items[]
 *           (topicId resolution: 'discard' → null, иначе tempIdMap или
 *           existingId как есть; discarded/discardReason проставляются).
 *      8c. updateMany processedAt=now() по всем messageId батча.
 *   9. Если транзакция или агент упали — failedRuns++ для всех messages, throw.
 *  10. Освобождение Redis-lock (только если мы его взяли).
 *
 * Ручной enqueue — `enqueueManualRun()` — кладёт job в BullMQ-очередь
 * `core.feedback-digest`. Возвращает jobId. Используется из
 * `POST /admin/feedback/digest/run`.
 *
 * Источник: plans/tz/2026-05-25-user-feedback-with-ai-clustering.md.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  FEEDBACK_CLUSTER_LLM_PARAMS,
  FEEDBACK_CLUSTER_SYSTEM_PROMPT_FALLBACK,
  FEEDBACK_CLUSTER_TASK_TYPE,
  FEEDBACK_CLUSTER_USER_TEMPLATE,
  FeedbackClusterOutputSchema,
  type FeedbackClusterInput,
  type FeedbackClusterOutput,
  validateFeedbackClusterReferences,
} from '../prompts/feedback-cluster.prompt';
import { FeedbackDigestQueue } from '../workers/feedback-digest.queue';

/**
 * Результат одного прогона. `skipped=true` — если на момент прогона
 * не оказалось unprocessed-сообщений (нормально для пустой системы).
 */
export interface DigestResult {
  skipped: boolean;
  processed: number;
  newTopics: number;
  reason?: string;
}

/**
 * Redis-key для распределённого lock'а. Только один прогон digest'а на весь
 * кластер в один момент времени. TTL = 30 минут — заведомо больше реального
 * времени работы (батч 1000 сообщений + 2 LLM-попытки ≈ 5-10 минут).
 */
const FEEDBACK_DIGEST_LOCK_KEY = 'feedback:digest:lock';
const FEEDBACK_DIGEST_LOCK_TTL_SEC = 30 * 60;

/**
 * Размер батча — сколько FeedbackMessage берём в один прогон. Подобран под
 * контекст DeepSeek V4 Pro и стоимость одного вызова. При росте объёма
 * сделать ENV-переменную и/или sub-батчинг (фаза 2 ТЗ).
 */
const FEEDBACK_DIGEST_BATCH_SIZE = 1000;

/**
 * Сообщение модели на второй попытке, когда первая вернула невалидный JSON.
 * Приписывается к user-message — system остаётся прежним.
 */
const FEEDBACK_DIGEST_RETRY_HINT =
  '\n\nВНИМАНИЕ: предыдущий ответ не прошёл валидацию. ' +
  'Верни СТРОГО JSON по схеме feedback_cluster_v1, без markdown, без комментариев.';

@Injectable()
export class FeedbackDigestService {
  private readonly logger = new Logger(FeedbackDigestService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(FeedbackDigestQueue) private readonly queue: FeedbackDigestQueue,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  /**
   * Запустить один прогон digest'а. Используется и из cron'а, и из ручного
   * `POST /admin/feedback/digest/run` (через worker).
   */
  async runDigest(): Promise<DigestResult> {
    const lockToken = await this.acquireLock();
    if (!lockToken) {
      this.logger.warn(
        {
          lockKey: FEEDBACK_DIGEST_LOCK_KEY,
          result: 'lock_held',
        },
        'feedback-digest: lock уже занят другим прогоном — пропускаю',
      );
      this.metrics.incFeedbackDigestRun({ result: 'lock_held' });
      return { skipped: true, processed: 0, newTopics: 0, reason: 'lock-held' };
    }

    try {
      // 1. Собираем батч.
      const messages = await this.prisma.feedbackMessage.findMany({
        where: { processedAt: null, failedRuns: { lt: 3 } },
        orderBy: { createdAt: 'asc' },
        take: FEEDBACK_DIGEST_BATCH_SIZE,
        select: {
          id: true,
          userId: true,
          createdAt: true,
          text: true,
        },
      });

      if (messages.length === 0) {
        this.logger.log(
          {
            lockKey: FEEDBACK_DIGEST_LOCK_KEY,
            batchSize: 0,
            result: 'skipped',
          },
          'feedback-digest: пусто — нечего обрабатывать',
        );
        this.metrics.incFeedbackDigestRun({ result: 'skipped' });
        return {
          skipped: true,
          processed: 0,
          newTopics: 0,
          reason: 'empty-batch',
        };
      }

      // 2. Загружаем активные topics.
      const topics = await this.prisma.feedbackTopic.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, title: true, description: true },
      });

      const agentInput: FeedbackClusterInput = {
        messages: messages.map((m) => ({
          id: m.id,
          userId: m.userId,
          createdAt: m.createdAt.toISOString(),
          text: m.text,
        })),
        existingTopics: topics,
      };

      // 3. Зовём LLM с retry-on-invalid-output (две попытки с разным user-prompt).
      let agentOutput: FeedbackClusterOutput;
      try {
        agentOutput = await this.callAgentWithRetry(agentInput, messages.length);
      } catch (err) {
        await this.markBatchFailed(messages.map((m) => m.id));
        this.metrics.incFeedbackDigestRun({ result: 'agent_failed' });
        throw err;
      }

      // 4. Sanity-check: лимит новых блоков относительно объёма items.
      // Применяется только когда уже есть смысловые блоки (existingTopics >= 5);
      // на «холодном старте» (когда блоков ещё нет или их мало) агент по
      // определению создаёт новые блоки под каждую тему — это нормально, а не
      // аномалия. Триггер: >50% items идут в новые блоки И при этом достаточно
      // существующих, чтобы сравнение имело смысл.
      const totalItems = agentOutput.assignments.reduce(
        (acc, a) => acc + a.items.length,
        0,
      );
      const SANITY_CHECK_MIN_EXISTING_TOPICS = 5;
      if (
        topics.length >= SANITY_CHECK_MIN_EXISTING_TOPICS &&
        agentOutput.newTopics.length > 0 &&
        agentOutput.newTopics.length > totalItems * 0.5
      ) {
        await this.markBatchFailed(messages.map((m) => m.id));
        const reason =
          `feedback-digest: аномалия — newTopics=${agentOutput.newTopics.length} ` +
          `> 0.5 * totalItems=${totalItems}. Помечаю батч failed.`;
        this.logger.error(
          {
            lockKey: FEEDBACK_DIGEST_LOCK_KEY,
            batchSize: messages.length,
            newTopicsCount: agentOutput.newTopics.length,
            itemsCreated: totalItems,
            result: 'anomaly',
          },
          reason,
        );
        this.metrics.incFeedbackDigestRun({ result: 'anomaly' });
        throw new Error(reason);
      }

      // 5. Транзакционно сохраняем.
      const messageIds = messages.map((m) => m.id);
      try {
        await this.persistDigestResult({
          messageIds,
          output: agentOutput,
        });
      } catch (err) {
        await this.markBatchFailed(messageIds);
        this.metrics.incFeedbackDigestRun({ result: 'txn_failed' });
        throw err;
      }

      const discardedCount = agentOutput.assignments.reduce(
        (acc, a) => acc + a.items.filter((it) => it.topicRef === 'discard').length,
        0,
      );

      this.logger.log(
        {
          lockKey: FEEDBACK_DIGEST_LOCK_KEY,
          batchSize: messages.length,
          topicsCount: topics.length,
          newTopicsCreated: agentOutput.newTopics.length,
          itemsCreated: totalItems,
          discardedCount,
          result: 'success',
        },
        'feedback-digest: прогон завершён',
      );

      // Метрики (после успешной транзакции — единственное место, где увеличиваем).
      this.metrics.incFeedbackDigestRun({ result: 'success' });
      this.metrics.incFeedbackDigestMessagesProcessed(messages.length);
      this.metrics.incFeedbackDigestNewTopics(agentOutput.newTopics.length);

      return {
        skipped: false,
        processed: messages.length,
        newTopics: agentOutput.newTopics.length,
      };
    } finally {
      await this.releaseLock(lockToken);
    }
  }

  /**
   * Поставить job в BullMQ-очередь `core.feedback-digest` для ручного запуска
   * из admin-UI. Сам processor (`FeedbackDigestWorker`) внутренне зовёт
   * `runDigest()`.
   */
  async enqueueManualRun(): Promise<{ jobId: string }> {
    return this.queue.enqueueManualRun();
  }

  // ───────────────────────── private helpers ──────────────────────────────

  /**
   * Зов LLM с двумя попытками. Каждая попытка — отдельный `llm.call`,
   * внутри которого LlmRouter сам перебирает всю fallback-цепочку
   * (primary → secondary → tertiary). Если первая попытка дала невалидный
   * JSON — вторая попытка добавляет retry-hint в user-message.
   *
   * Каждый успешный текст-ответ парсим:
   *   - JSON.parse — может бросить SyntaxError;
   *   - FeedbackClusterOutputSchema.parse — Zod, бросает ZodError;
   *   - validateFeedbackClusterReferences — наш ref-checker, errors[]>0 → throw.
   *
   * На последний фейл — пробрасываем ошибку наверх (caller сам сделает
   * markBatchFailed).
   */
  private async callAgentWithRetry(
    input: FeedbackClusterInput,
    totalMessages: number,
  ): Promise<FeedbackClusterOutput> {
    const systemPrompt = FEEDBACK_CLUSTER_SYSTEM_PROMPT_FALLBACK;
    const baseUserMessage = FEEDBACK_CLUSTER_USER_TEMPLATE(input);

    const attempts: Array<{ label: string; userMessage: string }> = [
      { label: 'primary-chain', userMessage: baseUserMessage },
      {
        label: 'primary-chain-retry',
        userMessage: baseUserMessage + FEEDBACK_DIGEST_RETRY_HINT,
      },
    ];

    let lastError: Error | null = null;

    for (const attempt of attempts) {
      try {
        const result = await this.llm.call({
          taskType: FEEDBACK_CLUSTER_TASK_TYPE,
          systemPrompt,
          userMessage: attempt.userMessage,
          tenantId: null, // feedback — глобальный, не tenant-bound
          responseFormat: FEEDBACK_CLUSTER_LLM_PARAMS.responseFormat,
          maxTokens: FEEDBACK_CLUSTER_LLM_PARAMS.maxTokens,
        });

        // 1) parse JSON
        let raw: unknown;
        try {
          raw = JSON.parse(result.text);
        } catch (err) {
          throw new Error(
            `JSON.parse failed on attempt=${attempt.label} model=${result.modelUsed}: ` +
              (err instanceof Error ? err.message : String(err)),
          );
        }
        // 2) Zod
        const parsed = FeedbackClusterOutputSchema.safeParse(raw);
        if (!parsed.success) {
          throw new Error(
            `Zod validation failed on attempt=${attempt.label} model=${result.modelUsed}: ` +
              parsed.error.issues
                .slice(0, 3)
                .map((e) => `${e.path.join('.')}: ${e.message}`)
                .join('; '),
          );
        }
        // 3) referential
        const refs = validateFeedbackClusterReferences(parsed.data, input);
        if (!refs.ok) {
          throw new Error(
            `Referential validation failed on attempt=${attempt.label} model=${result.modelUsed}: ` +
              refs.errors.slice(0, 3).join('; '),
          );
        }

        this.logger.log(
          {
            attempt: attempt.label,
            model: result.modelUsed,
            totalMessages,
            newTopics: parsed.data.newTopics.length,
            assignments: parsed.data.assignments.length,
          },
          'feedback-digest: agent ok',
        );
        return parsed.data;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.logger.warn(
          {
            attempt: attempt.label,
            err: lastError.message,
          },
          'feedback-digest: попытка провалена',
        );
      }
    }

    throw new Error(
      `feedback-digest: все попытки агента провалены — ${lastError?.message ?? 'unknown'}`,
    );
  }

  /**
   * Сохранение результата в одной транзакции:
   *   - newTopics → FeedbackTopic.create (собираем map tempId→realId);
   *   - items     → FeedbackItem.create (resolve topicRef);
   *   - messages  → updateMany processedAt=now().
   *
   * Если транзакция упала — БД остаётся в исходном состоянии (atomic).
   */
  private async persistDigestResult(args: {
    messageIds: string[];
    output: FeedbackClusterOutput;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // 1. Создаём новые topics.
      const tempIdToRealId = new Map<string, string>();
      for (const nt of args.output.newTopics) {
        const created = await tx.feedbackTopic.create({
          data: {
            title: nt.title,
            description: nt.description,
          },
          select: { id: true },
        });
        tempIdToRealId.set(nt.tempId, created.id);
      }

      // 2. Создаём items.
      for (const a of args.output.assignments) {
        for (const item of a.items) {
          const isDiscard = item.topicRef === 'discard';
          let topicId: string | null;
          if (isDiscard) {
            topicId = null;
          } else if (tempIdToRealId.has(item.topicRef)) {
            topicId = tempIdToRealId.get(item.topicRef) ?? null;
          } else {
            // existing topic id — validateFeedbackClusterReferences гарантировал,
            // что он есть в БД на момент входа в агента.
            topicId = item.topicRef;
          }
          await tx.feedbackItem.create({
            data: {
              messageId: a.messageId,
              topicId,
              text: item.text,
              discarded: isDiscard,
              discardReason: isDiscard ? 'agent_marked' : null,
            },
          });
        }
      }

      // 3. Помечаем сообщения обработанными.
      await tx.feedbackMessage.updateMany({
        where: { id: { in: args.messageIds } },
        data: { processedAt: new Date() },
      });
    });
  }

  /**
   * При неудаче (LLM упал, валидация не прошла, транзакция упала) —
   * инкрементируем failedRuns у всех сообщений батча. На 3-й неудаче они
   * перестанут попадать в выборку (`failedRuns<3` в where) и попадут в
   * admin'скую страницу `/admin/feedback/messages/failed`.
   *
   * Делается через сырую SQL-инкрементацию — Prisma не умеет в одном
   * updateMany сделать `failedRuns = failedRuns + 1`.
   */
  private async markBatchFailed(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;
    try {
      await this.prisma.feedbackMessage.updateMany({
        where: { id: { in: messageIds } },
        data: { failedRuns: { increment: 1 } },
      });
      // Сколько сообщений достигли cap'а после инкремента — выпадают из выборки.
      const reachedCap = await this.prisma.feedbackMessage.count({
        where: { id: { in: messageIds }, failedRuns: { gte: 3 } },
      });
      this.logger.warn(
        {
          batchSize: messageIds.length,
          reachedCap,
          result: 'failed',
        },
        'feedback-digest: батч помечен failed (failedRuns++)',
      );
      if (reachedCap > 0) {
        this.metrics.incFeedbackDigestFailedRuns(reachedCap);
      }
    } catch (err) {
      this.logger.error(
        {
          batchSize: messageIds.length,
          err: err instanceof Error ? err.message : String(err),
        },
        'feedback-digest: не удалось проинкрементить failedRuns',
      );
    }
  }

  /**
   * Берём lock через SET NX EX. Возвращаем уникальный токен (для безопасного
   * release: если кто-то другой перехватил lock после TTL, мы случайно не
   * удалим его). Если SET вернул null — lock уже взят.
   */
  private async acquireLock(): Promise<string | null> {
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const ok = await this.redis.client.set(
        FEEDBACK_DIGEST_LOCK_KEY,
        token,
        'EX',
        FEEDBACK_DIGEST_LOCK_TTL_SEC,
        'NX',
      );
      return ok === 'OK' ? token : null;
    } catch (err) {
      // На Redis-сбое — fail-safe закрываемся (не запускаем прогон).
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'feedback-digest: не удалось взять Redis-lock — пропускаю прогон',
      );
      return null;
    }
  }

  /**
   * Освобождаем lock только если значение совпало с нашим token'ом.
   * Если совпадения нет (TTL истёк и кто-то другой взял lock) — не трогаем.
   */
  private async releaseLock(token: string | null): Promise<void> {
    if (!token) return;
    try {
      const current = await this.redis.client.get(FEEDBACK_DIGEST_LOCK_KEY);
      if (current === token) {
        await this.redis.client.del(FEEDBACK_DIGEST_LOCK_KEY);
      } else {
        this.logger.warn(
          'feedback-digest: lock token mismatch — не освобождаю (TTL истёк?)',
        );
      }
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'feedback-digest: ошибка при освобождении lock — игнорирую',
      );
    }
  }
}
