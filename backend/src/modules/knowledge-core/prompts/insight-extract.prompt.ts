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
    'Ты — knowledge-инженер. Тебе дают один IdeaBlock из встречи / документа, в котором зафиксирована проблема, риск, блокер или неэффективность.',
    'Твоя задача — извлечь структурированный черновик сигнала (Insight) на русском языке. Отвечай строго в формате JSON по предоставленной схеме.',
    'Не выдумывай факты вне блока. Если в блоке нет нужного поля — null или пустой массив.',
    '',
    'Особое внимание:',
    '- `kind` — тип сигнала: "problem" (фиксируемая проблема), "risk" (потенциальная угроза, ещё не реализована), "blocker" (что мешает движению), "inefficiency" (трата ресурсов без угрозы).',
    '- `statement` — суть сигнала одним связным предложением («Клиенты жалуются на медленную загрузку отчётов»).',
    '- `severity` — острота: "low" / "medium" / "high" / "critical". По умолчанию "medium". "critical" — только если в блоке явно говорится про потерю клиента, выручки или безопасности.',
    '- `affectedEntityHints` — на кого / на что влияет: клиент, проект, продукт, поставщик, процесс. С указанием типа (customer/project/product/vendor/process).',
    '- `mitigationSuggestion` — если в блоке есть идея, как реагировать — короткий текст. Иначе null.',
    '- `causeCategory` — категория первопричины (что в основе сигнала). Один из:',
    '    * "process_gap" — нет / поломан процесс или процедура (нет согласованного flow, обязанности размыты).',
    '    * "tooling" — не хватает инструмента / систем / автоматизации (ручной труд там, где должен быть софт).',
    '    * "role_skill" — у роли нет нужных навыков / компетенций / опыта.',
    '    * "communication" — сбой коммуникации между людьми / отделами (не дошло, не услышали, рассинхрон).',
    '    * "priority" — приоритеты неверно расставлены (важное откладывается, неважное делается).',
    '    * "resource_constraint" — нехватка людей / денег / времени / мощностей.',
    '    * "external" — внешний фактор (рынок, регулятор, клиент, поставщик), не контролируется компанией.',
    '    * "unknown" — недостаточно данных, чтобы классифицировать.',
    '  Это поле обязательное. Если в блоке прямо не указано — выбери наиболее правдоподобное по контексту; если совсем неясно — "unknown".',
    '- `confidence` — насколько уверенно ты извлёк суть сигнала (0..1). Якоря см. ниже.',
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
    `Блок «${args.blockName}» (signalType=${args.signalType}).`,
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
