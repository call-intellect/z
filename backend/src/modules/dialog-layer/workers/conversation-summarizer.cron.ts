import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  withInjectionGuard,
  wrapUserData,
} from '../../ai/services/prompts/common';
import { sanitizeCustomPrompt } from '../../ai/services/prompts/sanitize-custom-prompt';
import {
  DIALOG_SUMMARIZE_JSON_SCHEMA,
  DIALOG_SUMMARIZE_SYSTEM_PROMPT,
  buildSummarizeUserPrompt,
} from '../prompts/summarize.prompt';
import { tenantTopOf } from '../utils/tenant-top';

/**
 * SBA α-5 dialog-layer — ConversationSummarizerCron.
 *
 * Каждые 30 минут (configurable via `DIALOG_SUMMARIZER_CRON`) проходит
 * по диалогам, которые:
 *   - messageCount > `SUMMARIZER_MESSAGE_THRESHOLD` (default 12), И
 *   - (summaryUpdatedAt IS NULL OR summaryUpdatedAt < now() - staleness).
 *
 * Для каждого подходящего conversation:
 *  1. Берём ВСЕ messages КРОМЕ последних `summarizerKeepLast`.
 *  2. Вызываем LLM (taskType `dialog-summarize`).
 *  3. Парсим JSON → обновляем Conversation.summary + summaryUpdatedAt.
 *
 * Idempotent: если за последние staleness часов уже сжимали — пропускаем.
 * Batch-обработка: лимит 50 conversations за один run (защита от LLM-bomb).
 */

const BATCH_LIMIT = 50;

@Injectable()
export class ConversationSummarizerCron {
  private readonly logger = new Logger(ConversationSummarizerCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  /**
   * ТЗ 2026-05-24 §4 (F1.2) — мастер-флаг защиты от prompt-injection.
   * Defensive try/catch — в старых unit-тестах cfg может быть mock без
   * `aiFeatures`. Default — true (как в env.schema).
   */
  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  /**
   * Запускается по cron'у `DIALOG_SUMMARIZER_CRON` (default `*\/30 * * * *`).
   * Cron-выражение в декораторе литералом — `@nestjs/schedule` не поддерживает
   * runtime-cron-string для `@Cron()` без `SchedulerRegistry.addCronJob()`.
   * Здесь используем дефолт; ENV-override — vNext через registry.
   */
  @Cron('*/30 * * * *')
  async run(): Promise<void> {
    if (!this.cfg.dialogLayer.enabled) return;

    const threshold = this.cfg.dialogLayer.summarizerMessageThreshold;
    const stalenessHours = this.cfg.dialogLayer.summarizerStalenessHours;
    const staleBefore = new Date(Date.now() - stalenessHours * 3600 * 1000);

    try {
      const candidates = await this.findCandidates(threshold, staleBefore);
      if (candidates.length === 0) {
        this.logger.debug('ConversationSummarizer: нет кандидатов на сжатие');
        return;
      }
      this.logger.log(
        `ConversationSummarizer: запуск для ${candidates.length} conversation(s)`,
      );
      for (const conv of candidates) {
        try {
          await this.summarizeOne(conv);
        } catch (err) {
          this.logger.warn(
            {
              conversationId: conv.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'ConversationSummarizer: один conversation упал — продолжаем',
          );
        }
      }
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'ConversationSummarizer: общий сбой cron',
      );
    }
  }

  /**
   * Найти conversations: messageCount > threshold И stale (или без summary).
   * NB: messageCount считается через aggregate (нет денорм-колонки).
   */
  private async findCandidates(
    threshold: number,
    staleBefore: Date,
  ): Promise<Array<{ id: string; tenantId: string }>> {
    // Сначала — список conversation'ов, у которых ВООБЩЕ есть много messages.
    // Используем raw-aggregate через groupBy для эффективности.
    const grouped = await this.prisma.chatV2Message.groupBy({
      by: ['conversationId'],
      _count: { _all: true },
      having: { conversationId: { _count: { gt: threshold } } },
      orderBy: { conversationId: 'asc' },
      take: BATCH_LIMIT * 4,
    });
    if (grouped.length === 0) return [];

    const candidateIds = grouped.map((g) => g.conversationId);
    const convs = await this.prisma.chatV2Conversation.findMany({
      where: {
        id: { in: candidateIds },
        OR: [
          { summary: null },
          { summaryUpdatedAt: null },
          { summaryUpdatedAt: { lt: staleBefore } },
        ],
      },
      select: { id: true, tenantId: true },
      take: BATCH_LIMIT,
    });
    return convs;
  }

  private async summarizeOne(conv: {
    id: string;
    tenantId: string;
  }): Promise<void> {
    const keepLast = this.cfg.dialogLayer.summarizerKeepLast;

    // Берём ВСЕ messages этого conversation, кроме последних `keepLast`
    // (которые остаются «живыми» в systemPrompt).
    const total = await this.prisma.chatV2Message.count({
      where: { conversationId: conv.id },
    });
    const skipFromEnd = Math.min(total, keepLast);
    const toCompressCount = total - skipFromEnd;
    if (toCompressCount <= 0) return;

    const messages = await this.prisma.chatV2Message.findMany({
      where: { conversationId: conv.id },
      orderBy: { createdAt: 'asc' },
      take: toCompressCount,
      select: { role: true, text: true },
    });

    const previous = await this.prisma.chatV2Conversation.findUnique({
      where: { id: conv.id },
      select: { summary: true },
    });

    const startedAt = Date.now();
    // ТЗ 2026-05-24 §4 (F1.2) — обернуть пользовательские сообщения диалога
    // (messages + previousSummary) в маркеры данных + INJECTION_GUARD_NOTE
    // в system. Источник = 'chat'. Sanitize гоняем по тексту user-сообщений
    // (assistant-ответы тоже могут содержать echo инъекции).
    const guardOn = this.isPromptInjectionGuardEnabled();
    if (guardOn) {
      for (const m of messages) {
        const sanitized = sanitizeCustomPrompt(m.text);
        for (const pattern of sanitized.reasons) {
          this.metrics.incPromptInjectionAttempt({ source: 'chat', pattern });
        }
      }
    }
    const rawUser = buildSummarizeUserPrompt({
      messages: messages.map((m) => ({ role: m.role, content: m.text })),
      previousSummary: previous?.summary ?? null,
    });
    const systemText = guardOn
      ? withInjectionGuard(DIALOG_SUMMARIZE_SYSTEM_PROMPT)
      : DIALOG_SUMMARIZE_SYSTEM_PROMPT;
    const userText = guardOn ? wrapUserData(rawUser) : rawUser;
    const result = await this.llm.call({
      taskType: 'dialog-summarize',
      tenantId: conv.tenantId,
      systemPrompt: systemText,
      userMessage: userText,
      maxTokens: 600,
      // T7-F6: strict JSON Schema. Wrapper { summary, entities[] } — root object.
      responseFormat: {
        type: 'json_schema',
        name: 'dialog_summarize_response',
        strict: true,
        schema: DIALOG_SUMMARIZE_JSON_SCHEMA,
      },
      sourceRef: { type: 'chat_v2_conversation', id: conv.id },
    });
    const durationSeconds = (Date.now() - startedAt) / 1000;
    this.metrics.observeDialogProcessingDuration({
      step: 'summarize',
      seconds: durationSeconds,
    });

    const parsed = parseSummaryJson(result.text);
    if (parsed.parseError) {
      // T7-F6: ответ не парсится → метрика для observability. Не падаем —
      // следующий cron-tick попробует ещё раз с актуальной историей.
      this.metrics.incPromptInvalidResponse({
        taskType: 'dialog-summarize',
        model: result.modelUsed,
        reason: 'json_parse',
      });
    }
    if (!parsed.summary || parsed.summary.length === 0) {
      this.logger.warn(
        { conversationId: conv.id },
        'ConversationSummarizer: empty summary в ответе LLM — пропускаем update',
      );
      return;
    }

    const finalSummary = parsed.entities.length > 0
      ? `${parsed.summary}\n\nУпомянутые сущности: ${parsed.entities.join(', ')}`
      : parsed.summary;

    await this.prisma.chatV2Conversation.update({
      where: { id: conv.id },
      data: {
        summary: finalSummary.slice(0, 4000),
        summaryUpdatedAt: new Date(),
      },
    });
    this.metrics.incConversationSummary({
      tenantTop: tenantTopOf(conv.tenantId),
    });
    this.logger.log(
      {
        conversationId: conv.id,
        compressedMessages: toCompressCount,
        summaryChars: finalSummary.length,
      },
      'ConversationSummarizer: summary обновлён',
    );
  }
}

function parseSummaryJson(text: string): {
  summary: string;
  entities: string[];
  parseError: boolean;
} {
  try {
    const cleaned = stripCodeFence(text).trim();
    const parsed = JSON.parse(cleaned) as {
      summary?: unknown;
      entities?: unknown;
    };
    const summary =
      typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
    const entities = Array.isArray(parsed.entities)
      ? parsed.entities
          .filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
          .slice(0, 20)
      : [];
    return { summary, entities, parseError: false };
  } catch {
    return { summary: '', entities: [], parseError: true };
  }
}

function stripCodeFence(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
}
