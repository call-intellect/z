/**
 * SBA β-4 — Specialist 3.5 (Insights Radar).
 *
 * LLM-промпт `insight-extract` — из IdeaBlock с signalType ∈ { pain, risk,
 * churn_risk, objection } извлекает структурированный черновик Insight
 * (kind / statement / severity / affectedEntityHints / mitigationSuggestion).
 *
 * Возвращаемый JSON Schema strict — см. `INSIGHT_EXTRACT_JSON_SCHEMA`.
 *
 * TODO(owner-product): согласовать финальный текст промпта (см. зонтичный SBA §10).
 * Текущая версия — placeholder. Главное правило: НЕ выдумывать факты вне блока.
 * Если поле отсутствует — null / пустой массив. Имена сущностей — текстовыми
 * hint'ами, резолв через EntityResolutionService.findOrCreateEntity.
 */

export const INSIGHT_EXTRACT_SYSTEM_PROMPT = [
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
  '- `confidence` — насколько уверенно ты извлёк суть сигнала (0..1).',
].join('\n');

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
export const INSIGHT_EXTRACT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'statement', 'severity', 'confidence'],
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
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

export const INSIGHT_EXTRACT_SCHEMA_NAME = 'insight_extract_v1';
