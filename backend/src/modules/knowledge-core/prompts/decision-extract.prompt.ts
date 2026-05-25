/**
 * SBA β-3 — Specialist 3.3 (Decisions Registry).
 *
 * LLM-промпт `decision-extract` — из IdeaBlock с
 * `signalType ∈ { 'decision', 'rationale', 'decision_basis' }` извлекает
 * структурированный черновик решения (Decision).
 *
 * Возвращаемый JSON Schema strict — см. `DECISION_EXTRACT_JSON_SCHEMA`.
 * На входе — текст блока (criticalQuestion + trustedAnswer + tags + цитаты) +
 * контекст из ±2 минут той же встречи (для извлечения rationale).
 *
 * Главное правило: НЕ выдумывать факты вне блока. Если поле отсутствует —
 * null. Авторы и затронутые сущности — текстовыми hint'ами, резолв через
 * name-match выполняет сервис.
 */

import {
  withConfidenceCalibration,
  withEdgeCasePolicy,
} from '../../ai/services/prompts/common';

export const DECISION_EXTRACT_SYSTEM_PROMPT = withEdgeCasePolicy(
  withConfidenceCalibration(
    [
    'Ты — knowledge-инженер. Тебе дают один IdeaBlock из встречи / документа, в котором зафиксировано решение, либо обоснование решения.',
    'Твоя задача — извлечь структурированный черновик решения на русском языке. Отвечай строго в формате JSON по предоставленной схеме.',
    'Не выдумывай факты вне блока. Если в блоке нет нужного поля — оставь его null.',
    '',
    'Особое внимание:',
    '- `statement` — суть решения одним связным предложением («Ушли с поставщика X в пользу Y»).',
    '- `rationale` — ПОЧЕМУ так решили. Это самый ценный кусок: вытаскивай прямую логику из reasoning-блоков и цитат.',
    '- `alternatives` — какие варианты рассматривали и почему отвергли. Если в блоке об этом ничего — пустой массив.',
    '- `decidedByPersonHints` — имена людей, которые приняли решение (текст, как звучит в блоке).',
    '- `affectsEntityHints` — на кого / на что решение влияет: клиент, проект, продукт, поставщик. С указанием типа (customer/project/product/vendor/process).',
    '- `decidedAt` — если в блоке есть конкретная дата, верни ISO-8601. Иначе null.',
    '- `deadline` — срок исполнения решения. Если не упомянут — null.',
    '- `status` — по умолчанию "approved" (решение принято и зафиксировано). Используй другие значения только если в блоке явно сказано иначе.',
    '- `confidence` — насколько уверенно ты извлёк суть решения (0..1).',
    '',
    'ПРИМЕРЫ.',
    '',
    'Положительный пример (что извлечь):',
    'Блок «Поставщик SMS» (decision). Цитаты: «Иван: смотрели Twilio и SMS Aero. Маша: Twilio дорогой в России, SMS Aero справился с тестом доставки в 99%. Сергей: окей, идём с SMS Aero, договор подписываем на квартал».',
    'Вывод: {"statement": "Уходим к поставщику SMS Aero вместо Twilio.", "rationale": "Twilio слишком дорогой в России; SMS Aero показал 99% доставку на тестах.", "alternatives": [{"option": "Twilio", "reasonRejected": "дорогой в РФ"}], "decidedByPersonHints": ["Сергей"], "affectsEntityHints": [{"name": "SMS Aero", "type": "vendor"}], "decidedAt": null, "deadline": null, "status": "approved", "confidence": 0.85}.',
    '',
    'Что НЕ делать (edge case — пожелание без обязательства):',
    'Блок «Дизайн админки» (idea?). Цитаты: «Анна: хорошо бы когда-нибудь переделать админку под тёмную тему. Иван: да, не помешало бы».',
    'Вывод: {"statement": "недостаточно сигнала для извлечения решения", "rationale": null, "alternatives": [], "decidedByPersonHints": [], "affectsEntityHints": [], "decidedAt": null, "deadline": null, "status": "proposed", "confidence": 0.2}. Пояснение: «хорошо бы когда-нибудь» — пожелание, не решение; ответственного нет, срока нет → низкий confidence, status=proposed.',
    ].join('\n'),
  ),
);

export const DECISION_EXTRACT_USER_TEMPLATE = (args: {
  blockName: string;
  criticalQuestion: string;
  trustedAnswer: string;
  signalType: string;
  tags: readonly string[];
  evidenceQuotes: readonly string[];
  contextQuotes: readonly string[];
}): string => {
  const quotes = args.evidenceQuotes.length
    ? args.evidenceQuotes.map((q, i) => `  ${i + 1}. «${q}»`).join('\n')
    : '  (цитат нет)';
  const context = args.contextQuotes.length
    ? args.contextQuotes.map((q, i) => `  ${i + 1}. «${q}»`).join('\n')
    : '  (контекста нет)';
  const tags = args.tags.length ? args.tags.join(', ') : '(нет)';
  return [
    `Блок «${args.blockName}» (signalType=${args.signalType}).`,
    `Вопрос: ${args.criticalQuestion}`,
    `Ответ: ${args.trustedAnswer}`,
    `Теги: ${tags}`,
    `Цитаты-источники:`,
    quotes,
    '',
    `Контекст (±2 минуты той же встречи — для извлечения rationale):`,
    context,
    '',
    'Верни JSON-объект по схеме `decision_extract_v1`.',
  ].join('\n');
};

/**
 * JSON Schema strict для `decision-extract`. Поддерживается DeepSeek V4 и
 * OpenAI Responses API; Ollama (qwen3) fallback падает с
 * `LlmFormatNotSupportedError` — роутер переходит к secondary/primary.
 */
export const DECISION_EXTRACT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['statement', 'confidence'],
  properties: {
    statement: {
      type: 'string',
      minLength: 5,
      maxLength: 4_000,
      description: 'Суть решения одним связным предложением.',
    },
    rationale: {
      type: ['string', 'null'],
      maxLength: 4_000,
      description: 'Почему так решили — главный источник для Skill и Insights.',
    },
    alternatives: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['option'],
        properties: {
          option: { type: 'string', minLength: 1, maxLength: 500 },
          reasonRejected: {
            type: ['string', 'null'],
            maxLength: 1_000,
          },
        },
      },
    },
    decidedByPersonHints: {
      type: 'array',
      maxItems: 8,
      items: { type: 'string', minLength: 1, maxLength: 200 },
      description: 'Имена авторов решения (текст).',
    },
    affectsEntityHints: {
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
    decidedAt: {
      type: ['string', 'null'],
      description: 'ISO-8601 дата решения. null если в блоке не указано.',
    },
    deadline: {
      type: ['string', 'null'],
      description: 'ISO-8601 срок исполнения.',
    },
    status: {
      type: 'string',
      enum: [
        'proposed',
        'approved',
        'rejected',
        'implemented',
        'cancelled',
      ],
      description:
        'Статус решения. По умолчанию "approved" (зафиксировано как принятое).',
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

export const DECISION_EXTRACT_SCHEMA_NAME = 'decision_extract_v1';
