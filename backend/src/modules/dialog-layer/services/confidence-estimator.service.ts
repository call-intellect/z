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
  DIALOG_CONFIDENCE_JSON_SCHEMA,
  DIALOG_CONFIDENCE_SYSTEM_PROMPT,
  buildConfidenceUserPrompt,
} from '../prompts/confidence.prompt';
import { tenantTopOf } from '../utils/tenant-top';

/**
 * SBA α-5 dialog-layer — ConfidenceEstimatorService.
 *
 * Оценивает качество standalone-переформулировки. Если standalone полностью
 * совпадает с original (Contextualizer пропустил) — возвращает 1.0 без LLM.
 * Иначе — LLM-вызов с фиксированным JSON-форматом ответа.
 *
 * Если confidence < `CONTEXTUALIZER_CONFIDENCE_MIN` — caller должен
 * fallback'нуть на raw userMessage (метрика `dialog_confidence_low_total`).
 */

export interface ConfidenceInput {
  tenantId: string;
  userId: string;
  originalQuestion: string;
  standaloneQuestion: string;
  conversationId: string | null;
}

export interface ConfidenceResult {
  confidence: number;
  reason: string;
  llmCalled: boolean;
  durationSeconds: number;
  /** True если caller'у следует фолбэкнуться на raw userMessage. */
  shouldFallback: boolean;
}

@Injectable()
export class ConfidenceEstimatorService {
  private readonly logger = new Logger(ConfidenceEstimatorService.name);

  constructor(
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
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

  async estimate(input: ConfidenceInput): Promise<ConfidenceResult> {
    const startedAt = Date.now();
    const threshold = this.cfg.dialogLayer.contextualizerConfidenceMin;

    // No-op short-circuit: если standalone === original — высокая уверенность.
    if (input.standaloneQuestion.trim() === input.originalQuestion.trim()) {
      const durationSeconds = (Date.now() - startedAt) / 1000;
      this.metrics.observeDialogProcessingDuration({
        step: 'confidence',
        seconds: durationSeconds,
      });
      return {
        confidence: 1.0,
        reason: 'standalone-question совпадает с оригиналом',
        llmCalled: false,
        durationSeconds,
        shouldFallback: false,
      };
    }

    try {
      // ТЗ 2026-05-24 §4 (F1.2) — обернуть пользовательские формулировки
      // (original + standalone) в маркеры данных + INJECTION_GUARD_NOTE в
      // system. Источник = 'chat'. Sanitize гоняем по обоим текстам, чтобы
      // observability ловила инъекцию и в original, и в standalone.
      const guardOn = this.isPromptInjectionGuardEnabled();
      if (guardOn) {
        for (const q of [input.originalQuestion, input.standaloneQuestion]) {
          const sanitized = sanitizeCustomPrompt(q);
          for (const pattern of sanitized.reasons) {
            this.metrics.incPromptInjectionAttempt({ source: 'chat', pattern });
          }
        }
      }
      const rawUser = buildConfidenceUserPrompt({
        originalQuestion: input.originalQuestion,
        standaloneQuestion: input.standaloneQuestion,
      });
      const systemText = guardOn
        ? withInjectionGuard(DIALOG_CONFIDENCE_SYSTEM_PROMPT)
        : DIALOG_CONFIDENCE_SYSTEM_PROMPT;
      const userText = guardOn ? wrapUserData(rawUser) : rawUser;
      const result = await this.llm.call({
        taskType: 'dialog-confidence',
        tenantId: input.tenantId,
        userId: input.userId,
        systemPrompt: systemText,
        userMessage: userText,
        // ТЗ 2026-05-25 §10.4 Find 1 — для thinking-моделей (DeepSeek-Pro) минимум 1500.
        maxTokens: 1500,
        // T7-F6: strict JSON Schema.
        responseFormat: {
          type: 'json_schema',
          name: 'dialog_confidence_response',
          strict: true,
          schema: DIALOG_CONFIDENCE_JSON_SCHEMA,
        },
        sourceRef: input.conversationId
          ? { type: 'chat_v2_conversation', id: input.conversationId }
          : null,
      });
      const parsed = parseConfidenceJson(result.text);
      if (parsed.parseError) {
        this.metrics.incPromptInvalidResponse({
          taskType: 'dialog-confidence',
          model: result.modelUsed,
          reason: 'json_parse',
        });
      }
      const confidence = parsed.confidence;
      const shouldFallback = confidence < threshold;
      if (shouldFallback) {
        this.metrics.incDialogConfidenceLow({
          tenantTop: tenantTopOf(input.tenantId),
        });
      }
      const durationSeconds = (Date.now() - startedAt) / 1000;
      this.metrics.observeDialogProcessingDuration({
        step: 'confidence',
        seconds: durationSeconds,
      });
      return {
        confidence,
        reason: parsed.reason,
        llmCalled: true,
        durationSeconds,
        shouldFallback,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { conversationId: input.conversationId, err: message },
        'ConfidenceEstimator LLM упал — assume high confidence (не блокируем pipeline)',
      );
      const durationSeconds = (Date.now() - startedAt) / 1000;
      this.metrics.observeDialogProcessingDuration({
        step: 'confidence',
        seconds: durationSeconds,
      });
      return {
        confidence: 1.0,
        reason: 'LLM error — assume safe',
        llmCalled: false,
        durationSeconds,
        shouldFallback: false,
      };
    }
  }
}

/**
 * T7-F6: добавлено поле `parseError` — caller инкрементирует метрику
 * `z_prompt_invalid_response_total{reason='json_parse'}`. На уровне семантики
 * мы продолжаем фолбэк-ить на «safe high confidence», чтобы не блокировать
 * pipeline, но метрика теперь видит проблему.
 */
function parseConfidenceJson(text: string): {
  confidence: number;
  reason: string;
  parseError: boolean;
} {
  try {
    const cleaned = stripCodeFence(text).trim();
    const parsed = JSON.parse(cleaned) as {
      confidence?: unknown;
      reason?: unknown;
    };
    const conf =
      typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 1.0;
    const reason =
      typeof parsed.reason === 'string' ? parsed.reason : '';
    return { confidence: conf, reason, parseError: false };
  } catch {
    return {
      confidence: 1.0,
      reason: 'parse error — assume safe',
      parseError: true,
    };
  }
}

function stripCodeFence(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
}
