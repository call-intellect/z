import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
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
      const result = await this.llm.call({
        taskType: 'dialog-confidence',
        tenantId: input.tenantId,
        userId: input.userId,
        systemPrompt: DIALOG_CONFIDENCE_SYSTEM_PROMPT,
        userMessage: buildConfidenceUserPrompt({
          originalQuestion: input.originalQuestion,
          standaloneQuestion: input.standaloneQuestion,
        }),
        maxTokens: 120,
        sourceRef: input.conversationId
          ? { type: 'chat_v2_conversation', id: input.conversationId }
          : null,
      });
      const parsed = parseConfidenceJson(result.text);
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

function parseConfidenceJson(text: string): { confidence: number; reason: string } {
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
    return { confidence: conf, reason };
  } catch {
    return { confidence: 1.0, reason: 'parse error — assume safe' };
  }
}

function stripCodeFence(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
}
