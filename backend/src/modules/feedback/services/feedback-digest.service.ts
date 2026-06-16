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

export interface DigestResult {
  skipped: boolean;
  processed: number;
  newTopics: number;
  reason?: string;
}

const FEEDBACK_DIGEST_LOCK_KEY = 'feedback:digest:lock';
const FEEDBACK_DIGEST_LOCK_TTL_SEC = 30 * 60;

const FEEDBACK_DIGEST_BATCH_SIZE = 1000;

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

      let agentOutput: FeedbackClusterOutput;
      try {
        agentOutput = await this.callAgentWithRetry(agentInput, messages.length);
      } catch (err) {
        await this.markBatchFailed(messages.map((m) => m.id));
        this.metrics.incFeedbackDigestRun({ result: 'agent_failed' });
        throw err;
      }

      const totalItems = agentOutput.assignments.reduce((acc, a) => acc + a.items.length, 0);
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

  async enqueueManualRun(): Promise<{ jobId: string }> {
    return this.queue.enqueueManualRun();
  }

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
          tenantId: null,
          responseFormat: FEEDBACK_CLUSTER_LLM_PARAMS.responseFormat,
          maxTokens: FEEDBACK_CLUSTER_LLM_PARAMS.maxTokens,
        });

        let raw: unknown;
        try {
          raw = JSON.parse(result.text);
        } catch (err) {
          throw new Error(
            `JSON.parse failed on attempt=${attempt.label} model=${result.modelUsed}: ` +
              (err instanceof Error ? err.message : String(err)),
            { cause: err },
          );
        }
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

  private async persistDigestResult(args: {
    messageIds: string[];
    output: FeedbackClusterOutput;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
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

      for (const a of args.output.assignments) {
        for (const item of a.items) {
          const isDiscard = item.topicRef === 'discard';
          let topicId: string | null;
          if (isDiscard) {
            topicId = null;
          } else if (tempIdToRealId.has(item.topicRef)) {
            topicId = tempIdToRealId.get(item.topicRef) ?? null;
          } else {
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

      await tx.feedbackMessage.updateMany({
        where: { id: { in: args.messageIds } },
        data: { processedAt: new Date() },
      });
    });
  }

  private async markBatchFailed(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;
    try {
      await this.prisma.feedbackMessage.updateMany({
        where: { id: { in: messageIds } },
        data: { failedRuns: { increment: 1 } },
      });
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
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'feedback-digest: не удалось взять Redis-lock — пропускаю прогон',
      );
      return null;
    }
  }

  private async releaseLock(token: string | null): Promise<void> {
    if (!token) return;
    try {
      const current = await this.redis.client.get(FEEDBACK_DIGEST_LOCK_KEY);
      if (current === token) {
        await this.redis.client.del(FEEDBACK_DIGEST_LOCK_KEY);
      } else {
        this.logger.warn('feedback-digest: lock token mismatch — не освобождаю (TTL истёк?)');
      }
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'feedback-digest: ошибка при освобождении lock — игнорирую',
      );
    }
  }
}
