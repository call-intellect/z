import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  DIALOG_MULTI_QUERY_SYSTEM_PROMPT,
  buildMultiQueryUserPrompt,
} from '../prompts/multi-query.prompt';

import type { DialogIntent } from './query-classifier.service';

/**
 * SBA α-5 dialog-layer — MultiQueryExpansionService.
 *
 * Расширяет 1 вопрос → 3 переформулировки (синонимы / перспектива /
 * конкретизация). Запускается ТОЛЬКО для intent ∈ {exploratory, analytical},
 * чтобы не тратить cost на factual.
 *
 * Возвращает массив `[originalQuestion, ...expansions]` — оригинал всегда
 * первый, чтобы caller мог использовать первую формулировку как fallback
 * при пустом retrieval'е.
 */

export interface MultiQueryInput {
  tenantId: string;
  userId: string;
  question: string;
  intent: DialogIntent;
  conversationId: string | null;
}

export interface MultiQueryResult {
  queries: string[];
  expanded: boolean;
  durationSeconds: number;
}

@Injectable()
export class MultiQueryExpansionService {
  private readonly logger = new Logger(MultiQueryExpansionService.name);

  constructor(
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async expand(input: MultiQueryInput): Promise<MultiQueryResult> {
    const startedAt = Date.now();
    const enabled = this.cfg.dialogLayer.multiQueryExpansionEnabled;
    const intentNeedsExpansion =
      input.intent === 'exploratory' || input.intent === 'analytical';

    if (!enabled || !intentNeedsExpansion) {
      const durationSeconds = (Date.now() - startedAt) / 1000;
      this.metrics.observeDialogProcessingDuration({
        step: 'multi-query',
        seconds: durationSeconds,
      });
      return {
        queries: [input.question],
        expanded: false,
        durationSeconds,
      };
    }

    try {
      const result = await this.llm.call({
        taskType: 'dialog-multi-query',
        tenantId: input.tenantId,
        userId: input.userId,
        systemPrompt: DIALOG_MULTI_QUERY_SYSTEM_PROMPT,
        userMessage: buildMultiQueryUserPrompt({ question: input.question }),
        maxTokens: 300,
        sourceRef: input.conversationId
          ? { type: 'chat_v2_conversation', id: input.conversationId }
          : null,
      });
      const expansions = parseMultiQueryJson(result.text);
      const durationSeconds = (Date.now() - startedAt) / 1000;
      this.metrics.observeDialogProcessingDuration({
        step: 'multi-query',
        seconds: durationSeconds,
      });
      // Дедупим (originalQuestion + 3 expansion'а, фильтруем пустые/дубли).
      const seen = new Set<string>();
      const all = [input.question, ...expansions]
        .map((q) => q.trim())
        .filter((q) => {
          if (q.length === 0) return false;
          const k = q.toLowerCase();
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      return {
        queries: all,
        expanded: expansions.length > 0,
        durationSeconds,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { conversationId: input.conversationId, err: message },
        'MultiQueryExpansion LLM упал — возвращаем только оригинальный вопрос',
      );
      const durationSeconds = (Date.now() - startedAt) / 1000;
      this.metrics.observeDialogProcessingDuration({
        step: 'multi-query',
        seconds: durationSeconds,
      });
      return {
        queries: [input.question],
        expanded: false,
        durationSeconds,
      };
    }
  }
}

function parseMultiQueryJson(text: string): string[] {
  try {
    const cleaned = stripCodeFence(text).trim();
    const parsed = JSON.parse(cleaned) as { queries?: unknown };
    if (!Array.isArray(parsed.queries)) return [];
    return parsed.queries
      .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
      .slice(0, 3);
  } catch {
    return [];
  }
}

function stripCodeFence(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
}
