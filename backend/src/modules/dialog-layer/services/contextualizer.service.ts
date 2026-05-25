import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  withInjectionGuard,
  wrapUserData,
} from '../../ai/services/prompts/common';
import { sanitizeCustomPrompt } from '../../ai/services/prompts/sanitize-custom-prompt';
import {
  DIALOG_CONTEXTUALIZE_SYSTEM_PROMPT,
  buildContextualizeUserPrompt,
} from '../prompts/contextualize.prompt';

/**
 * SBA α-5 dialog-layer — ContextualizerService.
 *
 * Восстанавливает standalone-вопрос из последних N сообщений диалога +
 * Conversation.summary. Если history пуст и summary нет — возвращает
 * исходный userMessage без LLM-вызова (no-op + 0 cost).
 *
 * Если LLM упал — возвращает исходный userMessage (graceful degradation,
 * caller увидит низкое confidence на следующем шаге).
 */

export interface ContextualizeInput {
  tenantId: string;
  userId: string;
  question: string;
  summary: string | null;
  history: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
  conversationId: string | null;
}

export interface ContextualizeResult {
  standaloneQuestion: string;
  /** True, если LLM был вызван (history/summary были не пусты и удался вызов). */
  llmCalled: boolean;
  durationSeconds: number;
}

@Injectable()
export class ContextualizerService {
  private readonly logger = new Logger(ContextualizerService.name);

  constructor(
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
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

  async contextualize(
    input: ContextualizeInput,
  ): Promise<ContextualizeResult> {
    const startedAt = Date.now();
    const hasContext =
      (input.summary !== null && input.summary.length > 0) ||
      input.history.length > 0;

    if (!hasContext) {
      const durationSeconds = (Date.now() - startedAt) / 1000;
      this.metrics.observeDialogProcessingDuration({
        step: 'contextualize',
        seconds: durationSeconds,
      });
      return {
        standaloneQuestion: input.question,
        llmCalled: false,
        durationSeconds,
      };
    }

    try {
      // ТЗ 2026-05-24 §4 (F1.2) — обернуть пользовательский ввод (question +
      // history + summary) в маркеры данных + INJECTION_GUARD_NOTE в system.
      // Источник для метрики = 'chat'. Лёгкая sanitize-проверка по самому
      // user-вопросу — даёт observability на самой явной точке инъекции.
      const guardOn = this.isPromptInjectionGuardEnabled();
      if (guardOn) {
        const sanitized = sanitizeCustomPrompt(input.question);
        for (const pattern of sanitized.reasons) {
          this.metrics.incPromptInjectionAttempt({ source: 'chat', pattern });
        }
      }
      const rawUser = buildContextualizeUserPrompt({
        summary: input.summary,
        history: input.history,
        question: input.question,
      });
      const systemText = guardOn
        ? withInjectionGuard(DIALOG_CONTEXTUALIZE_SYSTEM_PROMPT)
        : DIALOG_CONTEXTUALIZE_SYSTEM_PROMPT;
      const userText = guardOn ? wrapUserData(rawUser) : rawUser;
      const result = await this.llm.call({
        taskType: 'dialog-contextualize',
        tenantId: input.tenantId,
        userId: input.userId,
        systemPrompt: systemText,
        userMessage: userText,
        // ТЗ 2026-05-25 §10.4 Find 1 — для thinking-моделей (DeepSeek-Pro) минимум 1500.
        maxTokens: 1500,
        sourceRef: input.conversationId
          ? { type: 'chat_v2_conversation', id: input.conversationId }
          : null,
      });
      const cleaned = (result.text ?? '')
        .trim()
        .replace(/^["'«»]+/, '')
        .replace(/["'«»]+$/, '');
      const standaloneQuestion = cleaned.length > 0 ? cleaned : input.question;
      const durationSeconds = (Date.now() - startedAt) / 1000;
      this.metrics.observeDialogProcessingDuration({
        step: 'contextualize',
        seconds: durationSeconds,
      });
      return { standaloneQuestion, llmCalled: true, durationSeconds };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { conversationId: input.conversationId, err: message },
        'Contextualizer LLM упал — fallback на raw userMessage',
      );
      const durationSeconds = (Date.now() - startedAt) / 1000;
      this.metrics.observeDialogProcessingDuration({
        step: 'contextualize',
        seconds: durationSeconds,
      });
      return {
        standaloneQuestion: input.question,
        llmCalled: false,
        durationSeconds,
      };
    }
  }
}
