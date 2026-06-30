import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';
import { sanitizeCustomPrompt } from '../../ai/services/prompts/sanitize-custom-prompt';
import { checkinFallbackHeuristic } from './checkin-fallback-triggers';
import {
  DIALOG_CLASSIFY_JSON_SCHEMA,
  DIALOG_CLASSIFY_SYSTEM_PROMPT,
  buildClassifyUserPrompt,
} from '../prompts/classify.prompt';

export type DialogIntent =
  | 'factual'
  | 'exploratory'
  | 'analytical'
  | 'clone_roleplay'
  | 'daily_plan_morning'
  | 'daily_report_evening'
  | 'note'
  | 'probe_reply';

export type QueryClass = 'list' | 'topic' | 'temporal' | 'overview' | 'fact';

export const QUERY_CLASSES: readonly QueryClass[] = [
  'list',
  'topic',
  'temporal',
  'overview',
  'fact',
] as const;

export function isQueryClass(v: unknown): v is QueryClass {
  return typeof v === 'string' && (QUERY_CLASSES as readonly string[]).includes(v);
}

export interface QueryClassResult {
  class: QueryClass;
  confidence: number;
}

const LIST_PATTERNS: RegExp[] = [
  /(?:какие|каких|какими)\s+встреч/i,
  /все\s+встреч/i,
  /встречи\s+(?:с|со|где|по)\s/i,
  /список/i,
  /покажи\s+(?:все|всё|список)/i,
  /перечисли/i,
  /с\s+кем\s+(?:встреч|общ|говор)/i,
  /документы\s+(?:про|по|о)\s/i,
  /все\s+(?:задачи|решения|документы|звонки)/i,
];

const TEMPORAL_PATTERNS: RegExp[] = [
  /итог[аи]?\s+(?:за|недел|месяц|квартал|спринт)/i,
  /что\s+было\s+за\s/i,
  /как\s+прош(?:ла|ёл|ел|ло)\s+(?:недел|месяц|квартал|спринт|день)/i,
  /результаты\s+за\s/i,
  /сводка\s+за\s/i,
  /за\s+(?:прошл(?:ую|ый|ое)|эт[уо]й?)\s+(?:недел|месяц|квартал)/i,
];

const OVERVIEW_PATTERNS: RegExp[] = [
  /что\s+у\s+нас\s+(?:по|с)\s/i,
  /обзор\s+по\s/i,
  /расскажи\s+про\s+(?:направлени|продаж|маркетинг|продукт|команд|финанс|операц)/i,
  /как\s+дела\s+(?:с|по)\s/i,
  /общ(?:ая|ее)\s+(?:картин|ситуац|положени)/i,
  /в\s+цел(?:ом|ое)\s+по\s/i,
];

const FACT_PATTERNS: RegExp[] = [
  /что\s+решили\s+по\s/i,
  /какое\s+решение/i,
  /когда/i,
  /сколько/i,
  /какой\s+статус/i,
  /какая\s+(?:дата|сумма|цена|стоимость)/i,
  /кто\s+(?:отвечает|ответствен)/i,
];

const TOPIC_PATTERNS: RegExp[] = [
  /обсуждали/i,
  /что\s+говорили\s+про\s/i,
  /что\s+известно\s+про\s/i,
  /про\s+что/i,
];

const QUERY_CLASS_CONFIDENT = 0.9;
const QUERY_CLASS_DEFAULT = 0.4;

export function classifyQueryClass(question: string): QueryClassResult {
  const q = typeof question === 'string' ? question : '';
  for (const p of LIST_PATTERNS) if (p.test(q)) return { class: 'list', confidence: QUERY_CLASS_CONFIDENT };
  for (const p of TEMPORAL_PATTERNS) if (p.test(q)) return { class: 'temporal', confidence: QUERY_CLASS_CONFIDENT };
  for (const p of OVERVIEW_PATTERNS) if (p.test(q)) return { class: 'overview', confidence: QUERY_CLASS_CONFIDENT };
  for (const p of FACT_PATTERNS) if (p.test(q)) return { class: 'fact', confidence: QUERY_CLASS_CONFIDENT };
  for (const p of TOPIC_PATTERNS) if (p.test(q)) return { class: 'topic', confidence: 0.7 };
  return { class: 'topic', confidence: QUERY_CLASS_DEFAULT };
}

export type ChatDialogIntent = 'factual' | 'exploratory' | 'analytical' | 'clone_roleplay';

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
  skipHeuristicFirstPass?: boolean;
  /**
   * ТЗ 2026-06-17 probe-system-phase2 Ф1 — текст последнего неотвеченного
   * probe-вопроса Коры этому пользователю. Если задан — подставляется в КОНЕЦ
   * USER-промпта (cache-friendly), и только тогда модель вправе вернуть
   * интент `probe_reply`. Если не задан — `probe_reply` недоступен (ловушка
   * в SYSTEM). Адаптеры каналов резолвят его до вызова классификатора.
   */
  openProbeQuestion?: string;
}

export interface ClassifyResult {
  intent: DialogIntent;
  source: 'heuristic' | 'llm' | 'fallback' | 'fallback_heuristic';
  confidence: number | null;
  durationSeconds: number;
}

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

  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  async classify(input: ClassifyInput): Promise<ClassifyResult> {
    const startedAt = Date.now();
    // ТЗ 2026-06-17 probe-phase2 Ф1 — при наличии открытого probe-вопроса
    // пропускаем дешёвую эвристику и сразу идём в LLM: эвристика не умеет
    // распознавать `probe_reply` и могла бы ошибочно увести ответ на probe
    // (например «Сколько?») в factual. С openProbeQuestion решает только LLM.
    const hasOpenProbe =
      typeof input.openProbeQuestion === 'string' &&
      input.openProbeQuestion.trim().length > 0;
    if (!input.skipHeuristicFirstPass && !hasOpenProbe) {
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
      const guardOn = this.isPromptInjectionGuardEnabled();
      if (guardOn) {
        const sanitized = sanitizeCustomPrompt(input.question);
        for (const pattern of sanitized.reasons) {
          this.metrics.incPromptInjectionAttempt({ source: 'chat', pattern });
        }
      }
      const rawUser = buildClassifyUserPrompt({
        question: input.question,
        openProbeQuestion: hasOpenProbe ? input.openProbeQuestion : undefined,
      });
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
        maxTokens: 1500,
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
      const checkinHit = checkinFallbackHeuristic(input.question);
      if (checkinHit) {
        const intent: DialogIntent =
          checkinHit.kind === 'morning' ? 'daily_plan_morning' : 'daily_report_evening';
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
  for (const p of FACTUAL_PATTERNS) {
    if (p.test(q)) return 'factual';
  }
  return null;
}

function parseClassifyJson(
  text: string,
): { intent: DialogIntent; confidence: number | null } | null {
  try {
    const cleaned = stripCodeFence(text).trim();
    const parsed = JSON.parse(cleaned) as {
      intent?: unknown;
      confidence?: unknown;
    };
    const raw = typeof parsed.intent === 'string' ? parsed.intent.toLowerCase() : '';
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
    case 'probe_reply': // ТЗ 2026-06-17 probe-phase2 Ф1 — ответ на probe-вопрос
      return raw;
    case 'clone-roleplay':
    case 'clone style':
    case 'clone':
      return 'clone_roleplay';
    case 'plan':
    case 'plan_morning':
    case 'morning_plan':
    case 'daily_plan':
      return 'daily_plan_morning';
    case 'report':
    case 'report_evening':
    case 'evening_report':
    case 'daily_report':
      return 'daily_report_evening';
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
