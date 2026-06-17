import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';
import { sanitizeCustomPrompt } from '../../ai/services/prompts/sanitize-custom-prompt';
import {
  DIALOG_MULTI_QUERY_CLONE_JSON_SCHEMA,
  DIALOG_MULTI_QUERY_CLONE_SYSTEM_PROMPT,
  buildMultiQueryCloneUserPrompt,
} from '../prompts/multi-query-clone.prompt';
import {
  DIALOG_QUERY_UNDERSTAND_JSON_SCHEMA,
  DIALOG_QUERY_UNDERSTAND_SYSTEM_PROMPT,
  buildQueryUnderstandUserPrompt,
} from '../prompts/query-understand.prompt';

import type { DialogIntent } from './query-classifier.service';

export interface MultiQueryInput {
  tenantId: string;
  userId: string;
  question: string;
  intent: DialogIntent;
  conversationId: string | null;
  summary?: string | null;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
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
    const shouldRun = enabled;

    if (!shouldRun) {
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
              systemPrompt: DIALOG_QUERY_UNDERSTAND_SYSTEM_PROMPT,
              jsonSchema: DIALOG_QUERY_UNDERSTAND_JSON_SCHEMA,
              userPrompt: buildQueryUnderstandUserPrompt({
                summary: input.summary ?? null,
                history: input.history ?? [],
                question: input.question,
              }),
              responseFormatName: 'dialog_multi_query_v2',
            };
      const systemText = guardOn
        ? withInjectionGuard(cfgByMode.systemPrompt)
        : cfgByMode.systemPrompt;
      const userText = guardOn ? wrapUserData(cfgByMode.userPrompt) : cfgByMode.userPrompt;
      const result = await this.llm.call({
        taskType: cfgByMode.taskType,
        tenantId: input.tenantId,
        userId: input.userId,
        systemPrompt: systemText,
        userMessage: userText,
        maxTokens: 1500,
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
