import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleInit,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { DataClass, LlmRouteTier, LlmTaskRoute } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

import { AiUsageLogService } from './ai-usage-log.service';
import { AnthropicService } from './anthropic.service';
import { DeepSeekService } from './deepseek.service';
import type {
  LlmCompleteInput,
  LlmCompleteOutput,
  LlmResponseFormat,
  LlmReasoningEffort,
} from './llm.types';
import { MinimaxService } from './minimax.service';
import { calcCostUsd, MODEL_PRICES } from './model-prices';
import { OllamaService } from './ollama.service';
import { OpenAiProxyService } from './openai-proxy.service';
import { LlmProtocolAdapterRegistry } from './protocol-adapter/llm-protocol-adapter.registry';
import { ProviderInfoResolver } from './protocol-adapter/provider-info.resolver';

/**
 * Семейство задач, для которых LlmRouter определяет провайдера.
 *
 * Legacy: summary/chapters/tasks/chat/regenerate-section/custom-prompt/
 * follow-up/clip-title/card-rollup/card-chat.
 *
 * Knowledge-core (Фаза 2+): block-ingest, block-distill, block-linker,
 * entity-resolver, entity-merge-arbiter, entity-graph-builder, theme-classify,
 * reframing, card-rollup-v2, task-extract-v2, chapter-extract-v2, summary-v2,
 * chat-v2, goal-alignment, dashboard-summary.
 */
export type LlmTaskType =
  | 'summary'
  | 'chapters'
  | 'tasks'
  | 'chat'
  | 'regenerate-section'
  | 'custom-prompt'
  | 'follow-up'
  | 'clip-title'
  | 'card-rollup'
  | 'card-chat'
  | 'block-ingest'
  | 'block-distill'
  | 'block-linker'
  | 'entity-resolver'
  | 'entity-merge-arbiter'
  | 'entity-graph-builder'
  | 'theme-classify'
  | 'reframing'
  | 'card-rollup-v2'
  | 'task-extract-v2'
  | 'chapter-extract-v2'
  | 'summary-v2'
  | 'chat-v2'
  | 'goal-alignment'
  | 'dashboard-summary'
  | 'role-profile-build'
  | 'transcript-clean-refine'
  // Фаза B — refine для метрик поведения (классификация filler/question).
  | 'behavior-refine'
  // Фаза C — AI-оценка качества встречи (sub-TZ C §5.4).
  | 'meeting-quality-score'
  // Фаза E — дополнительные («custom») AI-отчёты встречи. Один общий taskType
  // для всех шаблонов; per-template override — через UI админки моделей,
  // которая создаёт более специфичный route. См. ТЗ E §5.5.
  | 'custom-report'
  // SBA α-5 — Layer 5 Chat-v2 Omnichannel.
  // 'chat-v2-cite-select' — пост-обработка, выбор лучших цитат (опц., на α-5
  // не используется — заведён про запас).
  // 'chat-v2-conversation-title' — короткий title диалога (3-7 слов) из
  // первого user-сообщения (см. ConversationsService.generateTitle).
  | 'chat-v2-cite-select'
  | 'chat-v2-conversation-title'
  // SBA α-7 — Specialist 3.1 (Regulations / Processes / Policies).
  // 'regulation-extract' — извлечение черновика Regulation/Process/Policy из блока.
  // 'regulation-dedupe' — арбитр merge/new/extension/contradicts (KNN-кандидаты).
  // 'process-steps-extract' — извлечение упорядоченных шагов процесса.
  | 'regulation-extract'
  | 'regulation-dedupe'
  | 'process-steps-extract'
  // SBA α-7 wave 2 — Specialist 3.1 ProcessTemplate detector.
  // 'process-template-extract' — батч IdeaBlock'ов (signalType=process_step|methodology_step)
  // → массив кандидатов ProcessTemplate (name + summary + steps).
  | 'process-template-extract'
  // SBA β-2 — Specialist 3.2 (Knowledge Clone).
  // 'knowledge-clone-extract' — из набора блоков сотрудника → черновик
  //   knowledgeProfile (категории + опыт).
  // 'knowledge-clone-merge' — старый профиль + новый черновик → объединённый
  //   профиль с decay устаревших категорий.
  | 'knowledge-clone-extract'
  | 'knowledge-clone-merge'
  // SBA β-3 — Specialist 3.3 (Decisions Registry).
  // 'decision-extract' — из IdeaBlock (signalType=decision|rationale|decision_basis)
  //   → черновик Decision (statement + rationale + alternatives + hints).
  // 'decision-supersede-detect' — арбитр {new | merge | supersedes} по top-K KNN
  //   кандидатам; на supersedes — evolvingMeta для resolve.
  | 'decision-extract'
  | 'decision-supersede-detect'
  // SBA β-4 — Specialist 3.5 (Insights Radar).
  // 'insight-extract' — из IdeaBlock (signalType=pain|risk|churn_risk|objection)
  //   → черновик Insight (kind, statement, severity, affectedEntityHints, mitigationSuggestion).
  // 'insight-link-to-decisions' — для нового Insight найти Decision'ы, которые
  //   могли его спровоцировать (linked-decision arbiter).
  | 'insight-extract'
  | 'insight-link-to-decisions'
  // SBA β-5 — Specialist 3.6 (Ideas Collector) + Layer 6 (Probe-Agent).
  // 'idea-extract' — из IdeaBlock (signalType=idea|feature_request) → черновик Idea.
  // 'idea-cluster-merge' — арбитр кластеризации (new_cluster|add|standalone).
  // 'probe-formulate' — короткий точечный вопрос для Probe-Agent (2–4 inline options).
  // 'idea-status-summarize' — title+body для closing-loop нотификации
  //   supporter'ам идеи при изменении статуса.
  | 'idea-extract'
  | 'idea-cluster-merge'
  | 'probe-formulate'
  | 'idea-status-summarize'
  // SBA γ-1 — Specialist 3.7 (SkillProfile) + Clone API.
  // 'skill-trait-detect' — самая ответственная задача γ-1: 5+ reasoning-цитат
  //   сотрудника → один структурированный SkillTrait (эмерджентная категория +
  //   гипотезная формулировка + confidence). Качество модели здесь определяет
  //   полезность всей γ-фазы (см. зонтичный §3.4 + sub-TZ §12).
  // 'skill-trait-merge' — арбитр merge/supersedes/new по top-K KNN-кандидатам.
  // 'executable-persona-compile' — собирает persona prompt («думай как X»)
  //   из списка активных traits.
  // 'clone-respond' — генерирует ответ в стиле сотрудника на вопрос
  //   (persona prompt + subgraph context + question → текст + citations).
  | 'skill-trait-detect'
  | 'skill-trait-merge'
  | 'executable-persona-compile'
  | 'clone-respond'
  // SBA α-5 dialog-layer — препроцессор chat-v2 (Contextualizer / Confidence /
  // Classifier / MultiQuery / Summarizer). См.
  // plans/tz/2026-05-23-sba-alpha-5-dialog-layer-and-cache.md §9.
  // - dialog-contextualize: восстановление standalone-вопроса из истории.
  // - dialog-confidence: бинарная оценка качества контекстуализации.
  // - dialog-classify: intent ∈ {factual|exploratory|analytical|clone-roleplay}.
  // - dialog-multi-query: 3 переформулировки (синонимы/перспективы/конкретизация).
  // - dialog-summarize: сжатие старой части диалога (>12 сообщений) в summary.
  | 'dialog-contextualize'
  | 'dialog-confidence'
  | 'dialog-classify'
  | 'dialog-multi-query'
  | 'dialog-summarize'
  // SBA α-7 wave 2 — Specialist 3.1 ProcessTemplate detector.
  // 'process-template-extract' — батч IdeaBlock'ов
  //   (signalType=process_step|methodology_step) → массив кандидатов
  //   ProcessTemplate (name + summary + steps).
  | 'process-template-extract'
  // SBA α-3 wave 3 — AxisClassifierService + LLM-fallback Router.
  // 'axis-classify' — классификация IdeaBlock'а по 4 осям (who/functional/
  //   contextual/temporal). Дешёвый, частый — primary Ollama qwen3.5:9b.
  // 'router-fallback' — fallback роутер: для unmatched signalType
  //   определяем специалистов через LLM. Тот же провайдер-профиль.
  | 'axis-classify'
  | 'router-fallback'
  // SBA β-7 — Brand Voice Curator (Specialist 3.10).
  // 'brand-voice-extract' — daily-cron сборка BrandVoiceProfile из brand_corpus
  //   документов + brand_principle блоков → структурированный профиль
  //   (tone/values/taboos). Нужна высокая точность (стиль бренда — критичный
  //   контент), поэтому primary = gpt-4o.
  | 'brand-voice-extract'
  // SBA γ-3 — Cross-Functional Process + Handoff Tracker.
  // 'cross-functional-friction-summary' — короткое summary cross-functional
  //   friction-отчёта: на входе template + process_friction блоки + handoffs
  //   с slaViolations → описание (что тормозит) + recommendedAction.
  | 'cross-functional-friction-summary'
  // SBA α-8 wave 4 — Role Map builder + completeness rationale.
  // 'role-map-extract' — батч IdeaBlock'ов одной роли (signalType=expertise|
  //   competence|methodology_step|decision_basis|process_step) → массив
  //   нормализованных wave-2 элементов (responsibilities, authority, knowledge,
  //   decisions, interactions). См. plans/tz/2026-05-23-sba-alpha-8-wave4-*.md.
  // 'role-completeness-rationale' — короткое (1-3 предложения) объяснение для
  //   tooltip, почему такая completeness и что заполнить.
  | 'role-map-extract'
  | 'role-completeness-rationale'
  // SBA β-6 — Experiment Tracker (Specialist 3.9).
  // 'experiment-extract' — из IdeaBlock (signalType=hypothesis|result|lesson)
  //   → черновик Experiment (name, hypothesisText, currentResult?, lessons[],
  //   status, confidence). JSON Schema strict.
  // 'experiment-summarize-lessons' — digest-агрегатор уроков по серии
  //   завершённых экспериментов (используется в γ+ дайджестах; зарезервирован).
  | 'experiment-extract'
  | 'experiment-summarize-lessons'
  // SBA γ-2 — Concierge Agent (sквозной UX-слой через tool-use).
  // 'concierge-respond' — главный LLM-вызов: тoоl-use loop с whitelist tools.
  //   Primary = openai-via-proxy/gpt-4o (нужна качественная поддержка tool-use).
  // 'concierge-toolcall-validate' — валидация параметров tool call перед
  //   выполнением (lightweight). Primary = ollama/qwen3.5:9b.
  | 'concierge-respond'
  | 'concierge-toolcall-validate'
  // SBA β-8 — DailyCheckIn + OperationsDashboard.
  // 'checkin-parse' — из сырого ответа пользователя (морнинг/ивнинг) →
  //   структурированный { plans[], dones[], blockers[] } + confidence.
  //   < 0.6 → raw + curatorReview=true (см. DailyCheckInService).
  // 'operations-summary' — короткий narrative summary («пульс компании
  //   сейчас») поверх агрегата OperationsDashboardService. Используется
  //   COO dashboard'ом (на β-8 — опционально, фронт может не показывать).
  | 'checkin-parse'
  | 'operations-summary'
  // SBA δ-1 — Orchestrator (multi-agent research).
  // 'orchestrator-plan'        — план шагов: primary gpt-4o (важно качество reasoning).
  // 'orchestrator-subagent'    — универсальный subagent-call: primary deepseek (массово+дёшево).
  // 'orchestrator-synthesize'  — финальный синтез результатов: primary gpt-4o.
  // 'orchestrator-verify'      — верификация synthesis: primary ollama (быстро+локально).
  | 'orchestrator-plan'
  | 'orchestrator-subagent'
  | 'orchestrator-synthesize'
  | 'orchestrator-verify'
  // SBA δ-2 — ProactiveWatcher.
  // 'proactive-message-craft' — короткое friendly-сообщение по сработавшему
  //   правилу (не «АЛЕРТ», а «привет, заметил X — может посмотришь?»).
  //   Primary = ollama qwen3.5:9b (дёшево, локально, частые вызовы).
  | 'proactive-message-craft'
  // SBA Wave 2 — Specialist 3.8 (Helpfulness Agent).
  // 'helpfulness-detect' — из IdeaBlock извлекает helpfulness trait'ы
  //   (help_provided | proactive_hint | mentoring | emotional_support |
  //    constructive_feedback | question_unanswered | question_acknowledged_no_action).
  //   Primary = DeepSeek; secondary = OpenAI gpt-4o-mini; tertiary = Ollama qwen3.5:9b.
  // 'helpfulness-trait-merge' — арбитр merge/keep_separate для KNN-кандидата
  //   с похожим topicHint. Аналогичная цепочка.
  // 'helpfulness-spotlight-formulate' — тёплое короткое «спасибо» для публичной
  //   ленты. Нужна capable модель (DeepSeek pro / gpt-4o), чтобы текст не казённый.
  | 'helpfulness-detect'
  | 'helpfulness-trait-merge'
  | 'helpfulness-spotlight-formulate'
  // Wave 2 — Recognition Agent.
  // 'recognition-formulate' — формулировка благодарственного сообщения по
  //   контексту (thanks/idea_shipped/streak/weekly_summary). Короткое, тёплое,
  //   без официоза. Primary = deepseek-v4-flash; secondary = openai gpt-5.4-mini;
  //   tertiary = ollama qwen3.5:9b. Никогда от имени руководителя —
  //   только от имени AI / системы.
  | 'recognition-formulate';

/**
 * Полный кортеж всех `LlmTaskType` — единый источник правды для DTO admin'а.
 * Должен совпадать с union'ом выше, добавляются новые taskType ОДНОВРЕМЕННО
 * в обоих местах. tsc предупредит при несоответствии (через `satisfies`-trick
 * не делаем — TS пока без `Exhaustive<T>` helper'а на runtime-tuple).
 */
export const ALL_LLM_TASK_TYPES: readonly LlmTaskType[] = [
  'summary',
  'chapters',
  'tasks',
  'chat',
  'regenerate-section',
  'custom-prompt',
  'follow-up',
  'clip-title',
  'card-rollup',
  'card-chat',
  'block-ingest',
  'block-distill',
  'block-linker',
  'entity-resolver',
  'entity-merge-arbiter',
  'entity-graph-builder',
  'theme-classify',
  'reframing',
  'card-rollup-v2',
  'task-extract-v2',
  'chapter-extract-v2',
  'summary-v2',
  'chat-v2',
  'goal-alignment',
  'dashboard-summary',
  'role-profile-build',
  'transcript-clean-refine',
  'behavior-refine',
  'meeting-quality-score',
  'custom-report',
  'chat-v2-cite-select',
  'chat-v2-conversation-title',
  // SBA α-7
  'regulation-extract',
  'regulation-dedupe',
  'process-steps-extract',
  // SBA β-2
  'knowledge-clone-extract',
  'knowledge-clone-merge',
  // SBA β-3
  'decision-extract',
  'decision-supersede-detect',
  // SBA β-4
  'insight-extract',
  'insight-link-to-decisions',
  // SBA β-5
  'idea-extract',
  'idea-cluster-merge',
  'probe-formulate',
  'idea-status-summarize',
  // SBA γ-1
  'skill-trait-detect',
  'skill-trait-merge',
  'executable-persona-compile',
  'clone-respond',
  // SBA α-5 dialog-layer
  'dialog-contextualize',
  'dialog-confidence',
  'dialog-classify',
  'dialog-multi-query',
  'dialog-summarize',
  // SBA α-7 wave 2
  'process-template-extract',
  // SBA α-3 wave 3
  'axis-classify',
  'router-fallback',
  // SBA β-7
  'brand-voice-extract',
  // SBA γ-3
  'cross-functional-friction-summary',
  // SBA α-8 wave 4 — Role Map
  'role-map-extract',
  'role-completeness-rationale',
  // SBA γ-2 — Concierge Agent
  'concierge-respond',
  'concierge-toolcall-validate',
  // SBA β-8 — DailyCheckIn + Operations
  'checkin-parse',
  'operations-summary',
  // SBA δ-1 — Orchestrator
  'orchestrator-plan',
  'orchestrator-subagent',
  'orchestrator-synthesize',
  'orchestrator-verify',
  // SBA δ-2 — ProactiveWatcher
  'proactive-message-craft',
  // SBA Wave 2 — Specialist 3.8 Helpfulness Agent
  'helpfulness-detect',
  'helpfulness-trait-merge',
  'helpfulness-spotlight-formulate',
  // Wave 2 — Recognition Agent
  'recognition-formulate',
] as const;

/**
 * Имя провайдера, как оно хранится в `LlmTaskRoute.providers` (JSON-массив).
 * Для каждого провайдера в свитче ниже — соответствующий сервис.
 */
export type LlmProviderName =
  | 'anthropic'
  | 'minimax'
  | 'openai-via-proxy'
  | 'deepseek'
  | 'ollama';

const ALL_PROVIDERS: LlmProviderName[] = [
  'anthropic',
  'minimax',
  'openai-via-proxy',
  'deepseek',
  'ollama',
];

/**
 * Фаза 11 knowledge-core: per-provider capability map.
 *   - maxDataClass — самый «строгий» класс данных, который провайдер согласен
 *     обрабатывать. public < internal < sensitive < private.
 *   - localOnly — провайдер живёт локально (никогда не уходит наружу).
 *
 * `anthropic` — прямой Anthropic API; для нас это «sensitive» (договор).
 *   Если ANTHROPIC_USE_PROXY=true — фактически идёт через сторонний прокси,
 *   но capability в текущем MVP мы не понижаем (отслеживается ENV-флагом).
 * `minimax` / `openai-via-proxy` / `deepseek` — внешние, internal-only.
 * `ollama` — локальный, формально может обрабатывать private.
 *
 * Карта намеренно жёсткая — config-driven вариант (через БД) — vNext.
 */
const PROVIDER_CAPABILITY: Record<
  LlmProviderName,
  { maxDataClass: DataClass; localOnly: boolean }
> = {
  anthropic: { maxDataClass: 'sensitive', localOnly: false },
  minimax: { maxDataClass: 'internal', localOnly: false },
  'openai-via-proxy': { maxDataClass: 'internal', localOnly: false },
  deepseek: { maxDataClass: 'internal', localOnly: false },
  ollama: { maxDataClass: 'private', localOnly: true },
};

/**
 * Порядок DataClass: public < internal < sensitive < private.
 * Используется для `provider.maxDataClass >= dataClass` сравнения.
 */
const DATA_CLASS_RANK: Record<DataClass, number> = {
  public: 0,
  internal: 1,
  sensitive: 2,
  private: 3,
};

/**
 * Возвращает «строжайший» из переданных DataClass'ов. Используется в
 * call-site'ах LLM-вызовов, где входных блоков/документов больше одного
 * (chat retrieval, distill judge, summary v2 и т.п.). Дефолт — 'internal'.
 *
 * Пустой/отсутствующий вход → 'internal' (чтобы вызовы без явного
 * dataClass не оказывались более строгими, чем нужно).
 */
export function maxDataClass(
  classes: Array<DataClass | null | undefined>,
): DataClass {
  let best: DataClass = 'internal';
  for (const c of classes) {
    if (!c) continue;
    if (DATA_CLASS_RANK[c] > DATA_CLASS_RANK[best]) {
      best = c;
    }
  }
  return best;
}

const DEFAULT_FALLBACK_CHAIN: ProviderEntry[] = [
  { provider: 'deepseek', tier: 'primary' },
  { provider: 'openai-via-proxy', tier: 'secondary' },
  { provider: 'ollama', tier: 'tertiary' },
];

/**
 * Порядок tier'ов в цепочке fallback'а. primary всегда сначала, tertiary — последний.
 * Используется в `refreshCache()` для сортировки tier-нормализованных записей.
 */
const TIER_RANK: Record<LlmRouteTier, number> = {
  primary: 0,
  secondary: 1,
  tertiary: 2,
};

interface ProviderEntry {
  provider: LlmProviderName;
  model?: string;
  /**
   * Фаза A.4 — уровень в цепочке fallback'а. NULL = legacy запись (одноуровневая
   * цепочка, tier'ы не определены — пишем в AiUsageLog.tier как `primary` для
   * первого, `secondary` для второго и т.д. по позиции).
   */
  tier?: LlmRouteTier;
}

/**
 * Параметры эксперимента LlmTaskRoute.experiment.
 *
 *  - modelA / modelB — `<provider>:<model>` (например `deepseek:deepseek-v4-flash`).
 *  - splitPercent: доля трафика на A в процентах (0..100).
 *  - startedAt / endsAt — ISO-строки.
 */
interface ExperimentConfig {
  enabled?: boolean;
  modelA?: string;
  modelB?: string;
  splitPercent?: number;
  startedAt?: string;
  endsAt?: string;
}

interface PriceCacheEntry {
  inputPer1M: number;
  outputPer1M: number;
  cachedPer1M: number;
  fetchedAt: number;
}

const PRICE_CACHE_TTL_MS = 60_000;

export interface LlmCallParams {
  taskType: LlmTaskType;
  systemPrompt: string;
  userMessage: string;
  /**
   * tenantId — обязательное поле (Фаза 0 knowledge-core).
   *
   * Все вызовы LLM должны быть атрибутированы Org для биллинга/аналитики.
   * Если caller не может определить tenantId (system jobs, scheduled tasks
   * без owner) — допустимо передать null явно, но это исключение.
   */
  tenantId: string | null;
  meetingId?: string;
  userId?: string;
  jobId?: string;
  /** Структурированный вывод. */
  responseFormat?: LlmResponseFormat;
  /** Усилия модели на reasoning (для gpt-5* и deepseek-v4-pro). */
  reasoningEffort?: LlmReasoningEffort;
  maxTokens?: number;
  /**
   * Если задан — переопределяет модель провайдера. Полезно для бенчмарков
   * (одна и та же задача → разные модели).
   */
  model?: string;
  /** Указатель на источник вызова для drill-down в Z-Admin (Фаза 7). */
  sourceRef?: { type: string; id: string } | null;
  /**
   * Класс данных вызова (Фаза 11 knowledge-core).
   *
   * Определяет, какие провайдеры могут обработать запрос: только те, у
   * которых `maxDataClass >= dataClass`. Если caller не передал —
   * считаем 'internal' (большинство business-данных).
   *
   * Источник:
   *   - воркеры над блоками — max(IdeaBlock.dataClass) по входным;
   *   - chat — max по retrieval pool;
   *   - meeting-уровень — наследуем из Meeting/RawEvent.
   */
  dataClass?: DataClass;
}

export interface LlmCallResult {
  text: string;
  /** Формат: `<provider>:<model>` (e.g. `deepseek:deepseek-v4-flash`). */
  modelUsed: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  durationMs: number;
  /**
   * Фаза A.4 — фактический tier цепочки, который отработал. Каждый caller,
   * которому это важно (например, ai.quality-score выставляет
   * `degradedMode=true` при `tier=tertiary` — sub-TZ C §5.4), может использовать
   * это поле без подмены ответа в LlmRouter. NULL для legacy/нестабильных
   * вызовов, где tier не определялся (тоже маловероятно после A.4).
   */
  tier?: LlmRouteTier | null;
  /** Имя провайдера, который реально ответил (в дополнение к `modelUsed`). */
  providerUsed?: string;
}

export class LlmRouterAllProvidersFailedError extends Error {
  constructor(
    readonly taskType: LlmTaskType,
    readonly errors: Array<{ provider: string; message: string }>,
  ) {
    super(
      `LlmRouter: все провайдеры упали для taskType=${taskType}: ` +
        errors.map((e) => `${e.provider}=${e.message}`).join('; '),
    );
    this.name = 'LlmRouterAllProvidersFailedError';
  }
}

/**
 * Фаза 11: ни один провайдер не подходит под требуемый dataClass.
 * Бросается, когда `provider.maxDataClass < dataClass` для всех кандидатов.
 * Caller должен либо понизить dataClass (если это допустимо политикой
 * безопасности), либо подключить локальный провайдер.
 */
export class NoEligibleProviderError extends Error {
  readonly code = 'no_provider_for_data_class';
  constructor(
    readonly taskType: LlmTaskType,
    readonly dataClass: DataClass,
    readonly attemptedProviders: string[],
  ) {
    super(
      `LlmRouter: ни один провайдер не поддерживает dataClass='${dataClass}' для taskType='${taskType}'. ` +
        `Кандидаты: ${attemptedProviders.join(', ') || '(none)'}.`,
    );
    this.name = 'NoEligibleProviderError';
  }
}

/**
 * Маршрутизатор LLM-вызовов по `LlmTaskRoute` записям из БД.
 *
 * - При старте подгружает все routes в in-memory кэш.
 * - Раз в минуту обновляет кэш (через `@Cron('*\/1 * * * *')`).
 * - На каждый вызов: подбирает providers по `taskType` (или дефолт),
 *   пробует последовательно. Успех — пишет в `AiUsageLog` + метрика
 *   `llm_router_dispatch_total{status='success'}`. Падение — переключение
 *   с метрикой `status='fallback'`. Все упали → `status='failed'` + exception.
 * - A/B-эксперименты через `LlmTaskRoute.experiment`: при `enabled=true`
 *   и в окне `[startedAt, endsAt)` — рандомно по `splitPercent` выбираем
 *   A или B и пишем `experimentGroup` в `AiUsageLog`.
 * - Цена считается по `LlmModelPrice` (БД); при отсутствии записи — fallback
 *   на `MODEL_PRICES` из кода. Цены кэшируются в памяти на 60 секунд.
 */
@Injectable()
export class LlmRouterService implements OnModuleInit {
  private readonly logger = new Logger(LlmRouterService.name);
  private routes = new Map<LlmTaskType, ProviderEntry[]>();
  /**
   * Хранится отдельно от `routes`: при `isActive=false` маршрут игнорируется
   * (используется дефолтная цепочка), но видим в `getRoutes()` для админ-UI.
   */
  private allRoutes: LlmTaskRoute[] = [];
  private priceCache = new Map<string, PriceCacheEntry>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AnthropicService) private readonly anthropic: AnthropicService,
    @Inject(MinimaxService) private readonly minimax: MinimaxService,
    @Inject(OpenAiProxyService) private readonly openai: OpenAiProxyService,
    @Inject(DeepSeekService) private readonly deepseek: DeepSeekService,
    @Inject(OllamaService) private readonly ollama: OllamaService,
    @Inject(AiUsageLogService) private readonly usage: AiUsageLogService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
    // SBA α-10 wave 3 — Adapter Registry (feature-flag). Optional, чтобы тесты
    // без DI на регистре продолжали работать.
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
    @Optional()
    @Inject(LlmProtocolAdapterRegistry)
    private readonly adapterRegistry?: LlmProtocolAdapterRegistry,
    @Optional()
    @Inject(ProviderInfoResolver)
    private readonly providerInfo?: ProviderInfoResolver,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refreshCache().catch((err) => {
      this.logger.warn(
        `onModuleInit: не удалось загрузить routes: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  /**
   * Cron — каждую минуту синкает кэш с БД. Если админ изменил route через UI,
   * максимум 60 секунд до применения.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async refreshCacheTick(): Promise<void> {
    try {
      await this.refreshCache();
    } catch (err) {
      this.logger.warn(
        `refreshCacheTick: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Перечитать routes из БД. Вызывается из cron и из `setRoute` (немедленная
   * инвалидация после изменения).
   */
  async refreshCache(): Promise<void> {
    const all = await this.prisma.llmTaskRoute.findMany();
    this.allRoutes = all;
    const map = new Map<LlmTaskType, ProviderEntry[]>();

    // Фаза A.4 — нормализованные записи (tier NOT NULL) имеют приоритет.
    // Группируем по taskType, сортируем primary → secondary → tertiary,
    // внутри tier'а — по priority asc. Внутри одной (taskType, tier, providerName)
    // запись уже уникальна по @@unique.
    const tieredByTask = new Map<LlmTaskType, LlmTaskRoute[]>();
    for (const r of all) {
      if (!r.isActive) continue;
      if (r.tenantId !== null) continue; // org-overrides не входят в дефолт-кэш
      if (r.tier == null || r.providerName == null) continue;
      const list = tieredByTask.get(r.taskType as LlmTaskType) ?? [];
      list.push(r);
      tieredByTask.set(r.taskType as LlmTaskType, list);
    }
    for (const [taskType, list] of tieredByTask.entries()) {
      const sorted = list
        .slice()
        .sort((a, b) => {
          const ta = TIER_RANK[a.tier as LlmRouteTier];
          const tb = TIER_RANK[b.tier as LlmRouteTier];
          if (ta !== tb) return ta - tb;
          return a.priority - b.priority;
        })
        .filter((r) => (ALL_PROVIDERS as string[]).includes(r.providerName ?? ''))
        .map((r) => ({
          provider: r.providerName as LlmProviderName,
          ...(r.model ? { model: r.model } : {}),
          tier: r.tier as LlmRouteTier,
        }));
      if (sorted.length > 0) {
        map.set(taskType, sorted);
      }
    }

    // Legacy: для taskType'ов без tier-записей берём старую JSON-форму.
    for (const r of all) {
      if (!r.isActive) continue;
      if (r.tenantId !== null) continue;
      if (r.tier != null) continue; // нормализованные уже учли выше
      if (map.has(r.taskType as LlmTaskType)) continue; // tier-цепочка уже задана
      const providers = parseProviders(r.providers);
      if (providers.length === 0) continue;
      map.set(r.taskType as LlmTaskType, providers);
    }
    this.routes = map;
    this.logger.debug(`refreshCache: загружено ${map.size} routes`);
  }

  async getRoutes(): Promise<LlmTaskRoute[]> {
    return [...this.allRoutes];
  }

  /**
   * Upsert route + немедленная инвалидация кэша. `providers` — массив имён
   * провайдеров в порядке fallback'а.
   */
  async setRoute(args: {
    taskType: LlmTaskType;
    providers: LlmProviderName[];
    isActive: boolean;
  }): Promise<LlmTaskRoute> {
    const valid = args.providers.filter((p) =>
      (ALL_PROVIDERS as string[]).includes(p),
    ) as LlmProviderName[];
    if (valid.length === 0) {
      throw new Error(`setRoute: пустой список валидных провайдеров для ${args.taskType}`);
    }
    const existing = await this.prisma.llmTaskRoute.findFirst({
      where: { taskType: args.taskType, tenantId: null },
    });
    const updated = existing
      ? await this.prisma.llmTaskRoute.update({
          where: { id: existing.id },
          data: {
            providers: valid as unknown as object,
            isActive: args.isActive,
          },
        })
      : await this.prisma.llmTaskRoute.create({
          data: {
            taskType: args.taskType,
            tenantId: null,
            providers: valid as unknown as object,
            isActive: args.isActive,
          },
        });
    await this.refreshCache();
    return updated;
  }

  /**
   * Главный метод. Пробует провайдеров последовательно, на любую ошибку —
   * следующий. На успех — записывает в AiUsageLog и возвращает результат.
   *
   * Фаза 11: если caller передал `params.dataClass` (или маршрут задаёт
   * `requiredDataClass`), результирующий класс данных = max двух. Затем
   * провайдеры фильтруются по `provider.maxDataClass >= effectiveClass`.
   * Если после фильтра пусто — `NoEligibleProviderError` + метрика
   * `core_data_class_violations_total` += 1.
   */
  async call(params: LlmCallParams): Promise<LlmCallResult> {
    const route = this.allRoutes.find(
      (r) => r.taskType === params.taskType && r.tenantId === null && r.isActive,
    );
    const effectiveDataClass = this.resolveEffectiveDataClass(route, params.dataClass);
    const { providers, experimentGroup } = this.chooseProviders(route, params);

    // Фаза 11: фильтр по dataClass.
    const filtered = providers.filter((entry) => {
      const cap = PROVIDER_CAPABILITY[entry.provider];
      return DATA_CLASS_RANK[cap.maxDataClass] >= DATA_CLASS_RANK[effectiveDataClass];
    });

    if (filtered.length === 0) {
      this.metrics?.incCoreDataClassViolation({
        taskType: params.taskType,
        attemptedClass: effectiveDataClass,
      });
      this.logger.error(
        {
          taskType: params.taskType,
          dataClass: effectiveDataClass,
          attempted: providers.map((p) => p.provider),
        },
        'LlmRouter: no eligible provider for dataClass — block dispatch',
      );
      throw new NoEligibleProviderError(
        params.taskType,
        effectiveDataClass,
        providers.map((p) => p.provider),
      );
    }

    const errors: Array<{ provider: string; message: string }> = [];
    const overallStartedAt = Date.now();
    // Фаза A.4 — какой tier фактически использовался на предыдущей итерации.
    // Используется для построения fallbackReason у следующего вызова.
    let lastFailTier: LlmRouteTier | null = null;

    for (let i = 0; i < filtered.length; i++) {
      const entry = filtered[i] as ProviderEntry;
      const startedAt = Date.now();
      // Фаза A.4 — какой tier фактически использован. Если у entry задан tier
      // (нормализованная запись) — берём его. Иначе считаем по позиции в filtered
      // ('primary'/'secondary'/'tertiary' для индекса 0/1/2; позиции >2 → 'tertiary').
      const effectiveTier: LlmRouteTier =
        entry.tier ?? (i === 0 ? 'primary' : i === 1 ? 'secondary' : 'tertiary');
      // Причина срабатывания fallback'а: null для первого (primary) вызова,
      // иначе '<source-tier>_<кодError>'. Используется в аналитике admin'а.
      const fallbackReason: string | null = i === 0
        ? null
        : `${lastFailTier ?? 'primary'}_${classifyError(errors[errors.length - 1]?.message ?? 'error')}`;
      try {
        const out = await this.dispatch(entry, params);
        const durationMs = Date.now() - startedAt;
        this.metrics?.incLlmRouterDispatch({
          taskType: params.taskType,
          provider: entry.provider,
          status: 'success',
        });
        const cachedTokens = out.cachedTokens ?? 0;
        const costUsd = await this.computeCostUsd(
          out.provider,
          out.model,
          out.inputTokens,
          out.outputTokens,
          cachedTokens,
        );
        await this.usage.record({
          tenantId: params.tenantId,
          meetingId: params.meetingId ?? null,
          userId: params.userId ?? null,
          taskType: params.taskType,
          agentType: this.taskTypeToAgentType(params.taskType),
          jobId: params.jobId ?? null,
          model: out.model,
          provider: out.provider,
          inputTokens: out.inputTokens,
          outputTokens: out.outputTokens,
          cachedTokens,
          costUsd,
          durationMs,
          success: true,
          sourceRef: params.sourceRef ?? null,
          experimentGroup,
          tier: effectiveTier,
          fallbackReason,
          // Z-Admin Фаза 7: превью промпта (system+user) и ответа для drill-down.
          // Truncate до 8KB на стороне AiUsageLogService.
          requestPreview: this.buildRequestPreview(
            params.systemPrompt,
            params.userMessage,
          ),
          responsePreview: out.text,
        });
        this.logger.log(
          {
            taskType: params.taskType,
            provider: entry.provider,
            model: out.model,
            durationMs,
            inputTokens: out.inputTokens,
            outputTokens: out.outputTokens,
            cachedTokens,
            experimentGroup,
            tier: effectiveTier,
            fallbackReason,
            meetingId: params.meetingId,
          },
          'LlmRouter dispatch success',
        );
        return {
          text: out.text,
          modelUsed: `${out.provider}:${out.model}`,
          inputTokens: out.inputTokens,
          outputTokens: out.outputTokens,
          cachedTokens,
          durationMs: Date.now() - overallStartedAt,
          tier: effectiveTier,
          providerUsed: out.provider,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ provider: entry.provider, message });
        lastFailTier = effectiveTier;
        const isLast = i === filtered.length - 1;
        this.metrics?.incLlmRouterDispatch({
          taskType: params.taskType,
          provider: entry.provider,
          status: isLast ? 'failed' : 'fallback',
        });
        this.logger.warn(
          {
            taskType: params.taskType,
            provider: entry.provider,
            durationMs: Date.now() - startedAt,
            isLast,
            tier: effectiveTier,
          },
          `LlmRouter dispatch ${isLast ? 'failed' : 'fallback'}: ${message}`,
        );
        // На последнем провайдере — записываем неуспешный AiUsageLog.
        if (isLast) {
          await this.usage.record({
            tenantId: params.tenantId,
            meetingId: params.meetingId ?? null,
            userId: params.userId ?? null,
            taskType: params.taskType,
            agentType: this.taskTypeToAgentType(params.taskType),
            jobId: params.jobId ?? null,
            model: entry.model ?? params.model ?? 'unknown',
            provider: this.providerNameToUsageProvider(entry.provider),
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            durationMs: Date.now() - startedAt,
            success: false,
            errorText: message,
            sourceRef: params.sourceRef ?? null,
            experimentGroup,
            tier: effectiveTier,
            fallbackReason,
            requestPreview: this.buildRequestPreview(
              params.systemPrompt,
              params.userMessage,
            ),
            responsePreview: null,
          });
        }
      }
    }

    // Фаза A.4 — все tier'ы упали → инкрементируем метрику отсутствия
    // подходящего провайдера. Это сигнал для on-call: ни primary, ни secondary,
    // ни tertiary не отвечают на конкретный taskType. Optional-chaining не только
    // на сервисе, но и на методе — на случай мока с неполным интерфейсом.
    this.metrics?.incCoreLlmNoProvider?.({ taskType: params.taskType });
    throw new LlmRouterAllProvidersFailedError(params.taskType, errors);
  }

  /**
   * Удобный helper: достать tenantId по meetingId. Если meeting не найден или
   * у него tenantId=null — вернёт null. Используется в воркерах AI, где
   * caller знает только meetingId.
   */
  async resolveTenantByMeeting(meetingId: string): Promise<string | null> {
    const m = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { tenantId: true },
    });
    return m?.tenantId ?? null;
  }

  /**
   * Helper: достать tenantId по userId (берём первый Membership).
   * Подходит для вызовов, не привязанных к встрече (chat cross-meeting и т.п.).
   */
  async resolveTenantByUser(userId: string): Promise<string | null> {
    const m = await this.prisma.membership.findFirst({
      where: { userId, org: { deletedAt: null } },
      select: { orgId: true },
      orderBy: { joinedAt: 'asc' },
    });
    return m?.orgId ?? null;
  }

  // ─────────────────────────── private ─────────────────────────────────────

  /**
   * Фаза 11: вычисление эффективного dataClass'а вызова.
   *
   *   max(params.dataClass ?? 'internal', route.requiredDataClass ?? 'internal').
   *
   * Берём «строжайший» из двух: caller знает класс входных данных, маршрут
   * может задавать минимальную чувствительность задачи (например, audit-flow
   * всегда 'sensitive').
   */
  private resolveEffectiveDataClass(
    route: LlmTaskRoute | undefined,
    callerClass: DataClass | undefined,
  ): DataClass {
    const fromCaller: DataClass = callerClass ?? 'internal';
    const fromRoute: DataClass = route?.requiredDataClass ?? 'internal';
    return DATA_CLASS_RANK[fromCaller] >= DATA_CLASS_RANK[fromRoute]
      ? fromCaller
      : fromRoute;
  }

  /**
   * Решает, какую цепочку провайдеров использовать с учётом A/B-эксперимента.
   * Возвращает providers и (опционально) метку группы для AiUsageLog.
   */
  private chooseProviders(
    route: LlmTaskRoute | undefined,
    params: LlmCallParams,
  ): { providers: ProviderEntry[]; experimentGroup: 'A' | 'B' | null } {
    if (route?.experiment) {
      const exp = route.experiment as ExperimentConfig;
      const now = Date.now();
      const startedAt = exp.startedAt ? Date.parse(exp.startedAt) : Number.NaN;
      const endsAt = exp.endsAt ? Date.parse(exp.endsAt) : Number.NaN;
      const inWindow =
        Number.isFinite(startedAt) &&
        Number.isFinite(endsAt) &&
        now >= startedAt &&
        now < endsAt;
      if (exp.enabled === true && inWindow && exp.modelA && exp.modelB) {
        const splitPercent = typeof exp.splitPercent === 'number' ? exp.splitPercent : 50;
        const pickA = Math.random() * 100 < splitPercent;
        const pick = pickA ? exp.modelA : exp.modelB;
        const entry = parseProviderModelString(pick);
        if (entry) {
          this.logger.debug(
            `experiment ${params.taskType}: group=${pickA ? 'A' : 'B'} → ${pick}`,
          );
          return { providers: [entry], experimentGroup: pickA ? 'A' : 'B' };
        }
      }
    }
    const cached = this.routes.get(params.taskType);
    if (cached && cached.length > 0) {
      return { providers: cached, experimentGroup: null };
    }
    return { providers: DEFAULT_FALLBACK_CHAIN, experimentGroup: null };
  }

  private async dispatch(
    entry: ProviderEntry,
    params: LlmCallParams,
  ): Promise<LlmCompleteOutput> {
    // Приоритет: явный override через params.model, иначе модель из route entry.
    const effectiveModel = params.model ?? entry.model;
    const input: LlmCompleteInput = {
      system: { text: params.systemPrompt, cacheControl: 'ephemeral' },
      user: params.userMessage,
      ...(params.maxTokens !== undefined ? { maxTokens: params.maxTokens } : {}),
      ...(effectiveModel !== undefined ? { model: effectiveModel } : {}),
      ...(params.responseFormat !== undefined
        ? { responseFormat: params.responseFormat }
        : {}),
      ...(params.reasoningEffort !== undefined
        ? { reasoningEffort: params.reasoningEffort }
        : {}),
    };
    // SBA α-10 wave 3 — Feature-flag USE_PROTOCOL_ADAPTER_REGISTRY.
    // false (default, production safety) → legacy switch ниже.
    // true → LlmProtocolAdapterRegistry резолвит protocolKind из LlmProvider/ENV.
    const useRegistry =
      this.cfg?.budget?.useProtocolAdapterRegistry === true &&
      this.adapterRegistry !== undefined &&
      this.providerInfo !== undefined;
    if (useRegistry) {
      const resolved = await this.providerInfo!.resolveByName(entry.provider);
      if (resolved) {
        const adapter = this.adapterRegistry!.resolve(resolved.protocolKind);
        return adapter.complete({ provider: resolved.info, input });
      }
      this.logger.warn(
        `LlmRouter: ProviderInfoResolver не нашёл провайдера ${entry.provider}; fallback на legacy switch`,
      );
    }
    switch (entry.provider) {
      case 'anthropic':
        return this.anthropic.complete(input);
      case 'minimax':
        return this.minimax.complete(input);
      case 'openai-via-proxy':
        return this.openai.complete(input);
      case 'deepseek':
        return this.deepseek.complete(input);
      case 'ollama':
        return this.ollama.complete(input);
      default: {
        const _exhaustive: never = entry.provider;
        throw new Error(`LlmRouter: неизвестный провайдер ${String(_exhaustive)}`);
      }
    }
  }

  /**
   * Стоимость вызова в USD. Сначала смотрим в `LlmModelPrice` (БД, актуальная
   * запись по effectiveFrom/effectiveTo). Если нет — fallback на код.
   * Кэшируем результат на 60 секунд, чтобы не бить БД на каждый LLM-вызов.
   */
  private async computeCostUsd(
    provider: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
    cachedTokens: number,
  ): Promise<number> {
    const key = `${provider}:${model}`;
    const cached = this.priceCache.get(key);
    const now = Date.now();
    let entry: PriceCacheEntry | null = null;
    if (cached && now - cached.fetchedAt < PRICE_CACHE_TTL_MS) {
      entry = cached;
    } else {
      try {
        const fromDb = await this.prisma.llmModelPrice.findFirst({
          where: {
            provider,
            model,
            effectiveFrom: { lte: new Date(now) },
            OR: [
              { effectiveTo: null },
              { effectiveTo: { gt: new Date(now) } },
            ],
          },
          orderBy: { effectiveFrom: 'desc' },
        });
        if (fromDb) {
          entry = {
            inputPer1M: Number(fromDb.inputCostPerMillionTokens),
            outputPer1M: Number(fromDb.outputCostPerMillionTokens),
            cachedPer1M: Number(fromDb.cachedCostPerMillionTokens),
            fetchedAt: now,
          };
          this.priceCache.set(key, entry);
        }
      } catch (err) {
        this.logger.warn(
          `computeCostUsd: db lookup failed (${key}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (entry) {
      const fullInputTokens = Math.max(0, inputTokens - cachedTokens);
      const cost =
        (fullInputTokens / 1_000_000) * entry.inputPer1M +
        (cachedTokens / 1_000_000) * entry.cachedPer1M +
        (outputTokens / 1_000_000) * entry.outputPer1M;
      return Math.round(cost * 1_000_000) / 1_000_000;
    }

    // Fallback на статическую карту в коде.
    if (!(model in MODEL_PRICES)) {
      this.logger.debug(
        `computeCostUsd: цена для ${key} не найдена ни в БД, ни в коде → 0`,
      );
    }
    return calcCostUsd(model, inputTokens, outputTokens, cachedTokens);
  }

  /**
   * Маппинг `taskType` → `agentType` для AiUsageLog. Существующая
   * `AiAgentType` enum в `AiUsageLogService` — сохраняем совместимость.
   */
  private taskTypeToAgentType(
    taskType: LlmTaskType,
  ): 'summary' | 'report-by-type' | 'follow-up' | 'tasks' | 'custom' {
    switch (taskType) {
      case 'summary':
      case 'summary-v2':
        return 'summary';
      case 'tasks':
      case 'task-extract-v2':
        return 'tasks';
      case 'follow-up':
        return 'follow-up';
      default:
        return 'custom';
    }
  }

  private providerNameToUsageProvider(
    p: LlmProviderName,
  ): 'anthropic' | 'minimax' | 'openai-via-proxy' | 'deepseek' | 'ollama' {
    return p;
  }

  /**
   * Превью промпта для AiUsageLog (Z-Admin Фаза 7).
   * Конкатенация system + user с метками. Truncate до 8KB делает AiUsageLogService.
   */
  private buildRequestPreview(systemPrompt: string, userMessage: string): string {
    return `[SYSTEM]\n${systemPrompt}\n\n[USER]\n${userMessage}`;
  }

  /**
   * Сбросить in-memory кэш цен. Вызывается из AdminPricesService при
   * изменении прайс-карты — следующий вызов прочитает свежие цены из БД.
   */
  refreshPrices(): void {
    this.priceCache.clear();
  }
}

/**
 * `LlmTaskRoute.providers` — Json. Поддерживаемые формы:
 *   - `string[]` — `['deepseek', 'openai-via-proxy']`.
 *   - `Array<{provider: string, model?: string}>` — c указанием модели.
 *   - `{providers: <одна из форм выше>}` — обёртка.
 *
 * Парсим в строгий список валидных provider+model.
 */
function parseProviders(raw: unknown): ProviderEntry[] {
  if (!raw) return [];
  let arr: unknown;
  if (Array.isArray(raw)) {
    arr = raw;
  } else if (
    typeof raw === 'object' &&
    raw !== null &&
    Array.isArray((raw as { providers?: unknown }).providers)
  ) {
    arr = (raw as { providers: unknown[] }).providers;
  } else {
    return [];
  }
  const result: ProviderEntry[] = [];
  for (const item of arr as unknown[]) {
    if (typeof item === 'string') {
      if ((ALL_PROVIDERS as string[]).includes(item)) {
        result.push({ provider: item as LlmProviderName });
      }
      continue;
    }
    if (typeof item === 'object' && item !== null) {
      const providerRaw = (item as { provider?: unknown }).provider;
      const modelRaw = (item as { model?: unknown }).model;
      if (typeof providerRaw === 'string' && (ALL_PROVIDERS as string[]).includes(providerRaw)) {
        result.push({
          provider: providerRaw as LlmProviderName,
          ...(typeof modelRaw === 'string' && modelRaw.length > 0
            ? { model: modelRaw }
            : {}),
        });
      }
    }
  }
  return result;
}

/**
 * Парсит строку формата `<provider>:<model>` (используется в
 * `LlmTaskRoute.experiment.modelA/modelB`).
 */
function parseProviderModelString(s: string): ProviderEntry | null {
  const idx = s.indexOf(':');
  if (idx <= 0 || idx === s.length - 1) return null;
  const provider = s.slice(0, idx);
  const model = s.slice(idx + 1);
  if (!(ALL_PROVIDERS as string[]).includes(provider)) return null;
  return { provider: provider as LlmProviderName, model };
}

/**
 * Фаза A.4 — классификация ошибки провайдера для `fallbackReason`. Из исходного
 * текста ошибки извлекаем короткий код: timeout / rate_limit / auth / network / error.
 * Используется в аналитике `/admin/ai-models` для понимания, почему случается fallback.
 */
function classifyError(message: string): string {
  const m = message.toLowerCase();
  if (/(timeout|timed out|etimedout|deadline)/.test(m)) return 'timeout';
  if (/(429|rate.?limit|too many requests|quota)/.test(m)) return 'rate_limit';
  if (/(401|403|unauthorized|forbidden|invalid.*key|api[_ ]?key)/.test(m)) return 'auth';
  if (/(econn|enotfound|eai_again|socket hang up|fetch failed|network)/.test(m)) return 'network';
  if (/5\d\d/.test(m)) return 'server_5xx';
  return 'error';
}
