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
  DIALOG_MULTI_QUERY_CLONE_JSON_SCHEMA,
  DIALOG_MULTI_QUERY_CLONE_SYSTEM_PROMPT,
  buildMultiQueryCloneUserPrompt,
} from '../prompts/multi-query-clone.prompt';
import {
  DIALOG_MULTI_QUERY_JSON_SCHEMA,
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
  /**
   * ТЗ 2026-05-25 §9.4.4 (clone-respond эволюция, Фаза 7) — режим
   * расширения. 'org' (default) — три синонимические переформулировки
   * (общий dialog-multi-query). 'clone' — три формулировки разного типа
   * (точная / ситуационный аналог / общий принцип) через отдельный
   * route `dialog-multi-query-clone`. Когда `mode='clone'`, intent
   * игнорируется (расширение запускается всегда — для клона аналоги нужны
   * даже на factual-вопрос, если judgmental).
   */
  mode?: 'org' | 'clone';
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

  async expand(input: MultiQueryInput): Promise<MultiQueryResult> {
    const startedAt = Date.now();
    const enabled = this.cfg.dialogLayer.multiQueryExpansionEnabled;
    const mode: 'org' | 'clone' = input.mode ?? 'org';
    // В режиме `clone` расширяем всегда — для клона аналоги полезны и на
    // factual-вопросах. В режиме `org` — только exploratory/analytical
    // (исторический gating).
    const intentNeedsExpansion =
      mode === 'clone' ||
      input.intent === 'exploratory' ||
      input.intent === 'analytical';

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
      // ТЗ 2026-05-24 §4 (F1.2) — обернуть пользовательский вопрос в маркеры
      // данных + INJECTION_GUARD_NOTE в system. Источник = 'chat'.
      const guardOn = this.isPromptInjectionGuardEnabled();
      if (guardOn) {
        const sanitized = sanitizeCustomPrompt(input.question);
        for (const pattern of sanitized.reasons) {
          this.metrics.incPromptInjectionAttempt({ source: 'chat', pattern });
        }
      }
      const cfgByMode =
        mode === 'clone'
          ? {
              taskType: 'dialog-multi-query-clone' as const,
              systemPrompt: DIALOG_MULTI_QUERY_CLONE_SYSTEM_PROMPT,
              jsonSchema: DIALOG_MULTI_QUERY_CLONE_JSON_SCHEMA,
              userPrompt: buildMultiQueryCloneUserPrompt({
                question: input.question,
              }),
              responseFormatName: 'dialog_multi_query_clone_response',
            }
          : {
              taskType: 'dialog-multi-query' as const,
              systemPrompt: DIALOG_MULTI_QUERY_SYSTEM_PROMPT,
              jsonSchema: DIALOG_MULTI_QUERY_JSON_SCHEMA,
              userPrompt: buildMultiQueryUserPrompt({
                question: input.question,
              }),
              responseFormatName: 'dialog_multi_query_response',
            };
      const systemText = guardOn
        ? withInjectionGuard(cfgByMode.systemPrompt)
        : cfgByMode.systemPrompt;
      const userText = guardOn
        ? wrapUserData(cfgByMode.userPrompt)
        : cfgByMode.userPrompt;
      const result = await this.llm.call({
        taskType: cfgByMode.taskType,
        tenantId: input.tenantId,
        userId: input.userId,
        systemPrompt: systemText,
        userMessage: userText,
        // ТЗ 2026-05-25 §10.4 Find 1 — для thinking-моделей (DeepSeek-Pro) минимум 1500.
        maxTokens: 1500,
        // T7-F6: strict JSON Schema. Wrapper { queries: [...] } — root object.
        responseFormat: {
          type: 'json_schema',
          name: cfgByMode.responseFormatName,
          strict: true,
          schema: cfgByMode.jsonSchema,
        },
        sourceRef: input.conversationId
          ? { type: 'chat_v2_conversation', id: input.conversationId }
          : null,
      });
      const expansions = parseMultiQueryJson(result.text);
      // T7-F6: если парсер вернул пустой массив на непустой ответ — невалидный
      // ответ. Пустой ответ от провайдера тоже считаем за невалидный
      // (модель должна вернуть ≥1 формулировку).
      if (expansions.length === 0 && result.text.length > 0) {
        this.metrics.incPromptInvalidResponse({
          taskType: cfgByMode.taskType,
          model: result.modelUsed,
          reason: 'json_parse',
        });
      }
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
