/**
 * SBA β-5 — Specialist 3.6 (Ideas Collector).
 *
 * LLM-промпт `idea-extract` — из IdeaBlock с signalType ∈ { idea,
 * feature_request } извлекает структурированный черновик Idea (kind /
 * statement / rationale / supporter hints).
 *
 * TODO(owner-product): согласовать финальный текст промпта (см. зонтичный
 * SBA §10). Текущая версия — placeholder. Главное правило: НЕ выдумывать
 * факты вне блока. Если поле отсутствует — null / пустой массив.
 */

export const IDEA_EXTRACT_SYSTEM_PROMPT = [
  'Ты — knowledge-инженер. Тебе дают один IdeaBlock из встречи / документа, в котором зафиксирована идея, предложение или запрос на доработку.',
  'Твоя задача — извлечь структурированный черновик идеи (Idea) на русском языке. Отвечай строго в формате JSON по предоставленной схеме.',
  'Не выдумывай факты вне блока. Если в блоке нет нужного поля — null или пустой массив.',
  '',
  'Особое внимание:',
  '- `kind` — "internal" если предложение исходит от сотрудника компании; "client_request" если предложение / запрос пришёл от клиента / партнёра.',
  '- `statement` — суть идеи одним связным предложением («Добавить тёмную тему интерфейса»).',
  '- `rationale` — почему так стоит сделать. Если в блоке нет — null.',
  '- `confidence` — насколько уверенно ты извлёк суть идеи (0..1).',
].join('\n');

export const IDEA_EXTRACT_USER_TEMPLATE = (args: {
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
    'Верни JSON-объект по схеме `idea_extract_v1`.',
  ].join('\n');
};

export const IDEA_EXTRACT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'statement', 'confidence'],
  properties: {
    kind: {
      type: 'string',
      enum: ['internal', 'client_request'],
      description: 'Кто инициатор идеи: сотрудник или клиент.',
    },
    statement: {
      type: 'string',
      minLength: 5,
      maxLength: 4_000,
      description: 'Суть идеи одним связным предложением.',
    },
    rationale: {
      type: ['string', 'null'],
      maxLength: 4_000,
      description: 'Почему так стоит сделать. Null если в блоке не указано.',
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

export const IDEA_EXTRACT_SCHEMA_NAME = 'idea_extract_v1';
