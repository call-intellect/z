/**
 * SBA β-4 — Specialist 3.5 (Insights Radar).
 *
 * LLM-промпт `insight-extract` — из IdeaBlock с signalType ∈ { pain, risk,
 * churn_risk, objection } извлекает структурированный черновик Insight
 * (kind / statement / severity / affectedEntityHints / mitigationSuggestion).
 *
 * Возвращаемый JSON Schema strict — см. `INSIGHT_EXTRACT_JSON_SCHEMA`.
 *
 * Главное правило: НЕ выдумывать факты вне блока.
 * Если поле отсутствует — null / пустой массив. Имена сущностей — текстовыми
 * hint'ами, резолв через EntityResolutionService.findOrCreateEntity.
 */

import {
  withAsrNote,
  withConfidenceCalibration,
  withDecisionDiscriminator,
  withEdgeCasePolicy,
} from '../../ai/services/prompts/common';

import { signalTypeLabel } from './signal-type-label';

// F2 (2026-05-24): mini-якоря для confidence (волна F8) удалены — теперь
// единый источник правды — `CONFIDENCE_CALIBRATION` из common.ts (через
// `withConfidenceCalibration`). Якорь для `severity` остаётся в тексте
// промта — это качественная шкала, не connected к confidence.
// F9 (2026-05-24): добавлен `withEdgeCasePolicy` — единая политика
// пустых/противоречивых входов и относительных сроков.
export const INSIGHT_EXTRACT_SYSTEM_PROMPT = withAsrNote(
  withDecisionDiscriminator(
  withEdgeCasePolicy(
  withConfidenceCalibration(
    [
    'Ты — радар проблем и рисков компании «Кора». Тебе дают один блок знания из встречи или документа, где зафиксирована проблема, риск, блокер или неэффективность.',
    '',
    '# Что держать в голове (смысл задачи)',
    '- Зачем это: проблемы, риски, блокеры и неэффективности всплывают на дашборде руководителя, чтобы реагировать рано, а не по факту потери.',
    '- Кому уйдёт результат: карточки риска/проблемы в кабинете руководителя.',
    '- Что станет с результатом: пропущенный риск = слепое пятно компании; выдуманный = ложная тревога; неверная первопричина (causeCategory) уводит реакцию не туда.',
    '',
    'Извлеки структурированный черновик сигнала на русском языке. Не выдумывай факты вне блока: нет поля — null или пустой массив.',
    '',
    'Особое внимание:',
    '- kind — "problem" (фиксируемая проблема), "risk" (потенциальная угроза, ещё не реализована), "blocker" (что мешает движению), "inefficiency" (трата ресурсов без угрозы).',
    '- statement — суть сигнала одним связным предложением.',
    '- severity — "low"/"medium"/"high"/"critical". По умолчанию "medium". "critical" — только если в блоке явно про потерю клиента, выручки или безопасности.',
    '- affectedEntityHints — на кого/на что влияет (с типом customer/project/product/vendor/process).',
    '- mitigationSuggestion — если в блоке есть идея реагирования, короткий текст; иначе null.',
    '- causeCategory (обязательно) — первопричина: process_gap (нет/поломан процесс), tooling (не хватает инструмента/автоматизации), role_skill (нет навыков у роли), communication (сбой коммуникации), priority (неверные приоритеты), resource_constraint (нехватка людей/денег/времени), external (внешний фактор), unknown (недостаточно данных). Если прямо не указано — выбери наиболее правдоподобную; совсем неясно — "unknown".',
    '- confidence — насколько уверенно извлёк суть сигнала (0..1).',
    '',
    '# Чистый русский на выходе',
    'Все человеческие строки (statement, mitigationSuggestion, имена сущностей) — на чистом русском, без кодов и латиницы. Технические поля (kind, severity, causeCategory) ты выбираешь из допустимых значений — в человеческий текст коды не вставляй.',
    '',
    '# Примеры (плохо → хорошо)',
    'Положительный (проблема + mitigation):',
    'Блок «Загрузка отчётов» (боль, проблема в работе). Цитаты: «Клиенты жалуются: отчёт грузится по минуте, кто-то уже не дожидается».',
    'Вывод: {"kind": "problem", "statement": "Клиенты жалуются на медленную загрузку отчётов (около минуты).", "severity": "high", "affectedEntityHints": [], "mitigationSuggestion": "Оптимизировать загрузку отчёта.", "causeCategory": "tooling", "confidence": 0.8}.',
    '',
    'Положительный (риск, не проблема — critical):',
    'Блок «Зависимость от клиента» (риск). Цитаты: «60% выручки даёт один клиент; если он уйдёт, будет очень тяжело».',
    'Вывод: {"kind": "risk", "statement": "60% выручки приходится на одного клиента — высокая зависимость.", "severity": "critical", "affectedEntityHints": [], "mitigationSuggestion": "Диверсифицировать клиентскую базу.", "causeCategory": "external", "confidence": 0.75}. Явная угроза выручке → critical; угроза ещё не реализована → risk, не problem.',
    '',
    'Что НЕ делать (разовая бытовая жалоба — не системный сигнал):',
    'Блок «Кофемашина». Цитаты: «Опять кофемашина сломалась, бесит».',
    'Вывод: {"kind": "inefficiency", "statement": "Сломалась кофемашина в офисе.", "severity": "low", "affectedEntityHints": [], "mitigationSuggestion": null, "causeCategory": "unknown", "confidence": 0.2}. Разовая бытовая жалоба-эмоция — не системный сигнал; низкий confidence (downstream-порог её отсечёт).',
    '',
    '# Перед тем как вернуть ответ — самопроверка',
    '1. kind верный (problem/risk/blocker/inefficiency)?',
    '2. severity обоснован (critical — только при явной потере клиента/выручки/безопасности)?',
    '3. causeCategory — наиболее правдоподобная первопричина, а не "unknown" по лени?',
    '4. Это системный сигнал, а не разовая бытовая жалоба/эмоция (иначе снизь confidence)?',
    '5. Ничего не выдумано; чистый русский без кодов?',
    '',
    'Верни строго JSON по схеме insight_extract_v2. Никакого текста вне JSON.',
    ].join('\n'),
  ),
  ),
  ),
);

export const INSIGHT_EXTRACT_USER_TEMPLATE = (args: {
  blockName: string;
  criticalQuestion: string;
  trustedAnswer: string;
  signalType: string;
  tags: readonly string[];
  evidenceQuotes: readonly string[];
}): string => {
  const quotes = args.evidenceQuotes.length
    ? args.evidenceQuotes.map((q, i) => `  ${i + 1}. «${q}»`).join('\n')
    : '  (цитат нет)';
  const tags = args.tags.length ? args.tags.join(', ') : '(нет)';
  return [
    `Блок «${args.blockName}».`,
    `Тип сигнала: ${signalTypeLabel(args.signalType)}.`,
    `Вопрос: ${args.criticalQuestion}`,
    `Ответ: ${args.trustedAnswer}`,
    `Теги: ${tags}`,
    `Цитаты-источники:`,
    quotes,
    '',
    'Верни JSON-объект по схеме `insight_extract_v1`.',
  ].join('\n');
};

/**
 * JSON Schema strict для `insight-extract`. Поддерживается DeepSeek V4 и
 * OpenAI Responses API; Ollama (qwen3) fallback падает с
 * `LlmFormatNotSupportedError` — роутер переходит на следующий tier.
 */
/**
 * Допустимые значения `Insight.causeCategory` (SBA β-4 wave 2 — 2026-05-23).
 * Источник правды — schema.prisma `Insight.causeCategory` (String, VarChar(40)).
 * Используется LLM (через JSON schema enum) и runtime-валидатором в сервисе.
 */
export const INSIGHT_CAUSE_CATEGORIES = [
  'process_gap',
  'tooling',
  'role_skill',
  'communication',
  'priority',
  'resource_constraint',
  'external',
  'unknown',
] as const;
export type InsightCauseCategory = (typeof INSIGHT_CAUSE_CATEGORIES)[number];

export const INSIGHT_EXTRACT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'statement', 'severity', 'causeCategory', 'confidence'],
  properties: {
    kind: {
      type: 'string',
      enum: ['problem', 'risk', 'blocker', 'inefficiency'],
      description: 'Тип сигнала.',
    },
    statement: {
      type: 'string',
      minLength: 5,
      maxLength: 4_000,
      description: 'Суть сигнала одним связным предложением.',
    },
    severity: {
      type: 'string',
      enum: ['low', 'medium', 'high', 'critical'],
      description: 'Острота сигнала.',
    },
    affectedEntityHints: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'type'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 300 },
          type: {
            type: 'string',
            enum: ['customer', 'project', 'product', 'vendor', 'process'],
          },
        },
      },
    },
    mitigationSuggestion: {
      type: ['string', 'null'],
      maxLength: 2_000,
      description:
        'Если в блоке есть идея реагирования — короткий текст. Иначе null.',
    },
    causeCategory: {
      type: 'string',
      enum: INSIGHT_CAUSE_CATEGORIES as unknown as string[],
      description:
        'Категория первопричины сигнала. См. INSIGHT_CAUSE_CATEGORIES.',
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

// SBA β-4 wave 2 (2026-05-23) — bump версии схемы после расширения required.
// Старый ответ без `causeCategory` не пройдёт strict-валидацию → роутер
// провалится на следующий tier. Это намеренно: модели слабых tier'ов
// должны дотягиваться до v2.
export const INSIGHT_EXTRACT_SCHEMA_NAME = 'insight_extract_v2';
