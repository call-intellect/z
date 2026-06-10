import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  withInjectionGuard,
  wrapUserData,
} from '../../ai/services/prompts/common';
import { sanitizeCustomPrompt } from '../../ai/services/prompts/sanitize-custom-prompt';
import { checkinFallbackHeuristic } from './checkin-fallback-triggers';
import {
  DIALOG_CLASSIFY_JSON_SCHEMA,
  DIALOG_CLASSIFY_SYSTEM_PROMPT,
  buildClassifyUserPrompt,
} from '../prompts/classify.prompt';

/**
 * SBA α-5 dialog-layer — QueryClassifierService.
 *
 * Гибрид:
 *  1. Эвристика по ключевым словам (русский + английский) — покрывает 60-70%
 *     дёшево и без LLM. Можно отключить через `skipHeuristicFirstPass=true`
 *     (см. ТЗ 2026-05-29 telegram-self-initiated-checkins) — для bot-flow,
 *     где «план на день» путаются с факт-вопросами по словарю эвристик.
 *  2. LLM-fallback на оставшиеся (taskType `dialog-classify`).
 *  3. При недоступности LLM — checkin-fallback-эвристика (5+5 триггеров,
 *     ловит самые очевидные «план/отчёт»), затем `factual` как последний
 *     резерв.
 *
 * Intent ∈ { factual | exploratory | analytical | clone_roleplay |
 *            daily_plan_morning | daily_report_evening | note | task |
 *            show_tasks }.
 */

export type DialogIntent =
  | 'factual'
  | 'exploratory'
  | 'analytical'
  | 'clone_roleplay'
  | 'daily_plan_morning'
  | 'daily_report_evening'
  | 'note'
  // ТЗ 2026-06-10 §2 — Telegram-бот: поставить задачу / показать мои задачи.
  // В web chat-v2 эти intent'ы сводятся к 'factual' (narrowToChatIntent) —
  // обычный запрос, без регрессии. Перехватываются только в bot-адаптере.
  | 'task'
  | 'show_tasks';

/**
 * Узкий подтип «классические chat-интенты» — 4 категории, на которые
 * рассчитаны существующие downstream-сервисы (chat-v2 synthesis,
 * clones-clone dialog wrapper). Новые intent'ы daily_plan_morning /
 * daily_report_evening / note туда не пробрасываются.
 *
 * ТЗ 2026-05-29 telegram-self-initiated-checkins: вводим helper, чтобы
 * существующие call-site (которые не должны знать про чек-ины) могли
 * безопасно сузить тип. Никаких daily-checkin/note значений в их потоке
 * не появится — bot-adapter маппит plan/report → InboundMessage
 * daily_checkin_self ещё до dialog-layer.
 */
export type ChatDialogIntent =
  | 'factual'
  | 'exploratory'
  | 'analytical'
  | 'clone_roleplay';

/**
 * Сужает 9-категорийный DialogIntent до 4-категорийного ChatDialogIntent
 * для legacy-потребителей. Не-chat intent'ы (daily_plan_morning /
 * daily_report_evening / note / task / show_tasks) маппятся в 'factual' —
 * это безопасный дефолт для chat-pipeline'а (не выбирает агрессивный режим
 * типа analytical/judgmental). На практике bot-adapter перехватывает эти
 * intent'ы раньше, и они никогда не доходят до chat-v2/clones (web —
 * без регрессии: task/show_tasks в вебе = обычный запрос → factual).
 */
export function narrowToChatIntent(intent: DialogIntent): ChatDialogIntent {
  switch (intent) {
    case 'factual':
    case 'exploratory':
    case 'analytical':
    case 'clone_roleplay':
      return intent;
    default:
      return 'factual';
  }
}

export interface ClassifyInput {
  tenantId: string;
  userId: string;
  question: string;
  conversationId: string | null;
  /**
   * ТЗ 2026-05-29 telegram-self-initiated-checkins §Backend.1 — отключение
   * heuristic first-pass. Bot-flow ставит `true`, чтобы каждое сообщение
   * шло в LLM (расширенный промпт с 7 категориями). Web-chat — оставляет
   * `false`/undefined, чтобы 60-70% вопросов закрывались эвристикой без
   * LLM-вызова.
   */
  skipHeuristicFirstPass?: boolean;
}

export interface ClassifyResult {
  intent: DialogIntent;
  source: 'heuristic' | 'llm' | 'fallback' | 'fallback_heuristic';
  /**
   * ТЗ 2026-05-29 §Backend.2 — confidence от LLM (0..1). NULL если intent
   * получен из эвристики/fallback (мы сами не знаем уверенность). Bot-adapter
   * использует gate <0.7 для plan/report → fall through в `note`.
   */
  confidence: number | null;
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

  async classify(input: ClassifyInput): Promise<ClassifyResult> {
    const startedAt = Date.now();
    if (!input.skipHeuristicFirstPass) {
      const heuristic = heuristicClassify(input.question);
      if (heuristic) {
        const durationSeconds = (Date.now() - startedAt) / 1000;
        this.metrics.observeDialogProcessingDuration({
          step: 'classify',
          seconds: durationSeconds,
        });
        return {
          intent: heuristic,
          source: 'heuristic',
          confidence: null,
          durationSeconds,
        };
      }
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
      const rawUser = buildClassifyUserPrompt({ question: input.question });
      const systemText = guardOn
        ? withInjectionGuard(DIALOG_CLASSIFY_SYSTEM_PROMPT)
        : DIALOG_CLASSIFY_SYSTEM_PROMPT;
      const userText = guardOn ? wrapUserData(rawUser) : rawUser;
      const result = await this.llm.call({
        taskType: 'dialog-classify',
        tenantId: input.tenantId,
        userId: input.userId,
        systemPrompt: systemText,
        userMessage: userText,
        // ТЗ 2026-05-25 §10.4 Find 1 — для thinking-моделей (DeepSeek-Pro) минимум 1500.
        maxTokens: 1500,
        // T7-F6: strict JSON Schema. Ollama выдаст LlmFormatNotSupportedError —
        // LlmRouter перейдёт на следующего провайдера в цепочке.
        responseFormat: {
          type: 'json_schema',
          name: 'dialog_classify_response',
          strict: true,
          schema: DIALOG_CLASSIFY_JSON_SCHEMA,
        },
        sourceRef: input.conversationId
          ? { type: 'chat_v2_conversation', id: input.conversationId }
          : null,
      });
      const parsed = parseClassifyJson(result.text);
      if (parsed === null) {
        this.metrics.incPromptInvalidResponse({
          taskType: 'dialog-classify',
          model: result.modelUsed,
          reason: 'json_parse',
        });
      }
      const finalIntent: DialogIntent = parsed?.intent ?? 'factual';
      const confidence = parsed?.confidence ?? null;
      const durationSeconds = (Date.now() - startedAt) / 1000;
      this.metrics.observeDialogProcessingDuration({
        step: 'classify',
        seconds: durationSeconds,
      });
      return { intent: finalIntent, source: 'llm', confidence, durationSeconds };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { conversationId: input.conversationId, err: message },
        'QueryClassifier LLM упал — пробую checkin-fallback-эвристику, затем factual',
      );
      const durationSeconds = (Date.now() - startedAt) / 1000;
      this.metrics.observeDialogProcessingDuration({
        step: 'classify',
        seconds: durationSeconds,
      });
      // ТЗ 2026-05-29 §Backend.1 — fallback-эвристика для plan/report ДО
      // factual'а. Если поймало — возвращаем daily_plan_morning/evening с
      // source='fallback_heuristic'. Иначе текущее поведение (factual+fallback).
      const checkinHit = checkinFallbackHeuristic(input.question);
      if (checkinHit) {
        const intent: DialogIntent =
          checkinHit.kind === 'morning'
            ? 'daily_plan_morning'
            : 'daily_report_evening';
        return {
          intent,
          source: 'fallback_heuristic',
          confidence: null,
          durationSeconds,
        };
      }
      return {
        intent: 'factual',
        source: 'fallback',
        confidence: null,
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

/**
 * T7-F6: возвращает `null`, если JSON не парсится — caller инкрементирует
 * метрику `z_prompt_invalid_response_total` и фолбэкается на 'factual'.
 *
 * ТЗ 2026-05-29 §Backend.1 — теперь возвращает intent + confidence (новое
 * поле). Alias'ы для дружелюбности к LLM, которые могут вернуть короткую
 * форму (`plan`, `report`, `statement` и т.п.).
 */
function parseClassifyJson(
  text: string,
): { intent: DialogIntent; confidence: number | null } | null {
  try {
    const cleaned = stripCodeFence(text).trim();
    const parsed = JSON.parse(cleaned) as {
      intent?: unknown;
      confidence?: unknown;
    };
    const raw =
      typeof parsed.intent === 'string' ? parsed.intent.toLowerCase() : '';
    const intent = mapRawIntent(raw);
    if (!intent) return null;
    const confRaw = parsed.confidence;
    const confidence =
      typeof confRaw === 'number' && Number.isFinite(confRaw)
        ? Math.max(0, Math.min(1, confRaw))
        : null;
    return { intent, confidence };
  } catch {
    return null;
  }
}

function mapRawIntent(raw: string): DialogIntent | null {
  switch (raw) {
    case 'factual':
    case 'exploratory':
    case 'analytical':
    case 'clone_roleplay':
    case 'daily_plan_morning':
    case 'daily_report_evening':
    case 'note':
    case 'task':
    case 'show_tasks':
      return raw;
    // task-alias'ы (ТЗ 2026-06-10 §2)
    case 'create_task':
    case 'new_task':
    case 'todo':
      return 'task';
    // show_tasks-alias'ы
    case 'list_tasks':
    case 'my_tasks':
    case 'show_my_tasks':
    case 'tasks':
      return 'show_tasks';
    // clone alias'ы (legacy)
    case 'clone-roleplay':
    case 'clone style':
    case 'clone':
      return 'clone_roleplay';
    // plan-alias'ы
    case 'plan':
    case 'plan_morning':
    case 'morning_plan':
    case 'daily_plan':
      return 'daily_plan_morning';
    // report-alias'ы
    case 'report':
    case 'report_evening':
    case 'evening_report':
    case 'daily_report':
      return 'daily_report_evening';
    // note-alias'ы
    case 'statement':
    case 'free_note':
    case 'freenote':
      return 'note';
    default:
      return null;
  }
}

function stripCodeFence(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
}
