import { Inject, Injectable, Logger } from '@nestjs/common';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  DIALOG_CLASSIFY_SYSTEM_PROMPT,
  buildClassifyUserPrompt,
} from '../prompts/classify.prompt';

/**
 * SBA α-5 dialog-layer — QueryClassifierService.
 *
 * Гибрид:
 *  1. Эвристика по ключевым словам (русский + английский) — покрывает 60-70%
 *     дёшево и без LLM.
 *  2. LLM-fallback на оставшиеся (taskType `dialog-classify`).
 *
 * Intent ∈ { factual | exploratory | analytical | clone_roleplay }.
 */

export type DialogIntent =
  | 'factual'
  | 'exploratory'
  | 'analytical'
  | 'clone_roleplay';

export interface ClassifyInput {
  tenantId: string;
  userId: string;
  question: string;
  conversationId: string | null;
}

export interface ClassifyResult {
  intent: DialogIntent;
  source: 'heuristic' | 'llm' | 'fallback';
  durationSeconds: number;
}

// NB: `\b` в JS regex работает только для ASCII word-chars — для кириллицы
// границы слов не определяет. Используем простые case-insensitive substring
// patterns. Это даёт чуть больше false-positives (например «всеобще» поймает
// «все»), но для эвристики 60-70% покрытия — приемлемо.
const EXPLORATORY_PATTERNS: RegExp[] = [
  /расскажи/i,
  /обзор/i,
  /что известно/i,
  /что мы знаем/i,
  /всё про/i,
  /все про/i,
  /\bsummary\b/i,
  /\boverview\b/i,
];

const ANALYTICAL_PATTERNS: RegExp[] = [
  /почему/i,
  /тренд/i,
  /сравни/i,
  /сравнить/i,
  /тенденц/i,
  /\banalyze\b/i,
  /вывод/i,
];

const FACTUAL_PATTERNS: RegExp[] = [
  /сколько/i,
  /когда/i,
  /какой/i,
  /какая/i,
  /какое/i,
  /какие/i,
  /дата/i,
  /цифр/i,
];

const CLONE_PATTERNS: RegExp[] = [
  /как (бы )?(?:иван|мария|сергей|он|она|сотрудник)/i,
  /в стиле/i,
  /персоной/i,
  /ответ как от/i,
];

@Injectable()
export class QueryClassifierService {
  private readonly logger = new Logger(QueryClassifierService.name);

  constructor(
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async classify(input: ClassifyInput): Promise<ClassifyResult> {
    const startedAt = Date.now();
    const heuristic = heuristicClassify(input.question);
    if (heuristic) {
      const durationSeconds = (Date.now() - startedAt) / 1000;
      this.metrics.observeDialogProcessingDuration({
        step: 'classify',
        seconds: durationSeconds,
      });
      return { intent: heuristic, source: 'heuristic', durationSeconds };
    }

    try {
      const result = await this.llm.call({
        taskType: 'dialog-classify',
        tenantId: input.tenantId,
        userId: input.userId,
        systemPrompt: DIALOG_CLASSIFY_SYSTEM_PROMPT,
        userMessage: buildClassifyUserPrompt({ question: input.question }),
        maxTokens: 60,
        sourceRef: input.conversationId
          ? { type: 'chat_v2_conversation', id: input.conversationId }
          : null,
      });
      const parsed = parseClassifyJson(result.text);
      const durationSeconds = (Date.now() - startedAt) / 1000;
      this.metrics.observeDialogProcessingDuration({
        step: 'classify',
        seconds: durationSeconds,
      });
      return { intent: parsed, source: 'llm', durationSeconds };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { conversationId: input.conversationId, err: message },
        'QueryClassifier LLM упал — fallback на factual',
      );
      const durationSeconds = (Date.now() - startedAt) / 1000;
      this.metrics.observeDialogProcessingDuration({
        step: 'classify',
        seconds: durationSeconds,
      });
      return {
        intent: 'factual',
        source: 'fallback',
        durationSeconds,
      };
    }
  }
}

function heuristicClassify(q: string): DialogIntent | null {
  for (const p of CLONE_PATTERNS) if (p.test(q)) return 'clone_roleplay';
  for (const p of ANALYTICAL_PATTERNS) if (p.test(q)) return 'analytical';
  for (const p of EXPLORATORY_PATTERNS) if (p.test(q)) return 'exploratory';
  // Factual-эвристика: «сколько/когда/какой...» В сочетании с вопросительным
  // знаком — почти всегда factual.
  for (const p of FACTUAL_PATTERNS) {
    if (p.test(q)) return 'factual';
  }
  return null;
}

function parseClassifyJson(text: string): DialogIntent {
  try {
    const cleaned = stripCodeFence(text).trim();
    const parsed = JSON.parse(cleaned) as { intent?: unknown };
    const raw =
      typeof parsed.intent === 'string' ? parsed.intent.toLowerCase() : '';
    if (
      raw === 'factual' ||
      raw === 'exploratory' ||
      raw === 'analytical' ||
      raw === 'clone_roleplay'
    ) {
      return raw;
    }
    if (raw === 'clone-roleplay' || raw === 'clone style' || raw === 'clone') {
      return 'clone_roleplay';
    }
    return 'factual';
  } catch {
    return 'factual';
  }
}

function stripCodeFence(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
}
