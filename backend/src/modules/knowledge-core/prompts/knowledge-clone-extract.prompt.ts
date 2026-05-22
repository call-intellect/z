/**
 * SBA β-2 — Specialist 3.2 (Knowledge Clone).
 *
 * LLM-промпт `knowledge-clone-extract` — из набора IdeaBlock'ов одного
 * сотрудника извлекает структурированный черновик «профиля знаний»:
 * категории компетенции (эмерджентные, не enum), наблюдения (observation
 * count + цитаты), связанные сущности и значимый опыт.
 *
 * TODO(owner-product): согласовать финальный текст промпта. Текущая версия —
 * placeholder под структуру из sub-TZ §4. Цель: сжать накопленные блоки в
 * короткий профиль вида «человек разбирается в X, Y и Z».
 *
 * NB: категории — это `string`-имена (не enum), потому что области
 * экспертизы заранее не известны и зависят от компании / роли. JSON Schema
 * запрещает дополнительные ключи (`additionalProperties=false`), но имена
 * категорий — свободные.
 */

export const KNOWLEDGE_CLONE_EXTRACT_SYSTEM_PROMPT = [
  'Ты — knowledge-инженер, который строит «профиль знаний» сотрудника компании на основе того, что он говорил и делал на встречах и в документах.',
  'Тебе дают набор IdeaBlock-ов — атомарных фактов / решений / рассуждений / комментариев этого сотрудника.',
  'Твоя задача — извлечь компактный профиль на русском языке в формате JSON по предоставленной схеме.',
  '',
  'Что такое категория знания:',
  '- Это область, в которой человек проявил экспертизу или опыт (например, «AI-pipeline в knowledge-core», «онбординг новых сотрудников», «переговоры с поставщиками»).',
  '- Категории — эмерджентные: ты сам их формулируешь по сути блоков. Не используй жёсткие шаблоны.',
  '- Объединяй похожие наблюдения в одну категорию, не дроби слишком мелко.',
  '',
  'Confidence по категории:',
  '- "high" — экспертиза подтверждена несколькими разными блоками (>=4 наблюдений) или явным владением темой;',
  '- "medium" — 2-3 наблюдения, в которых человек уверенно высказывался;',
  '- "low" — только 1 наблюдение или человек упоминает тему вскользь.',
  '',
  'Sample statements (1–3 на категорию) — короткие цитаты из блоков с blockId-источником.',
  '',
  'Experience highlights — отдельные значимые опыты, не вписавшиеся в категории (например, «запустил миграцию X в Q1 2026»). Опционально.',
  '',
  'Не выдумывай знания вне блоков. Если данных мало (1-3 блока) — верни одну категорию low/medium и оставь experienceHighlights пустым.',
].join('\n');

export interface KnowledgeCloneExtractBlockInput {
  blockId: string;
  name: string;
  signalType: string;
  criticalQuestion: string;
  trustedAnswer: string;
  tags: readonly string[];
  relatedEntityIds: readonly string[];
  createdAt: string;
  /** Короткие цитаты из IdeaBlockEvidence (до 3 на блок). */
  quotes: readonly string[];
}

export const KNOWLEDGE_CLONE_EXTRACT_USER_TEMPLATE = (args: {
  personName: string;
  blocks: readonly KnowledgeCloneExtractBlockInput[];
}): string => {
  const blockLines = args.blocks.slice(0, 60).map((b, i) => {
    const quotes = b.quotes.length
      ? b.quotes
          .slice(0, 3)
          .map((q) => `    цитата: «${q.slice(0, 300)}»`)
          .join('\n')
      : '    (цитат нет)';
    const tags = b.tags.length ? b.tags.join(', ') : '(нет)';
    return [
      `${i + 1}. blockId=${b.blockId} (${b.signalType}, ${b.createdAt})`,
      `   тема: ${b.name}`,
      `   вопрос: ${b.criticalQuestion}`,
      `   ответ: ${b.trustedAnswer}`,
      `   теги: ${tags}`,
      quotes,
    ].join('\n');
  });
  return [
    `Сотрудник: ${args.personName}`,
    `Блоков-источников: ${args.blocks.length}`,
    '',
    'Блоки (от свежих к более старым):',
    blockLines.join('\n\n'),
    '',
    'Верни JSON-объект по схеме `knowledge_clone_extract_v1`.',
  ].join('\n');
};

/**
 * JSON Schema strict для `knowledge-clone-extract`. Поддерживается DeepSeek V4
 * и OpenAI Responses API; Ollama (qwen3) фоллбэк может падать с
 * `LlmFormatNotSupportedError` — роутер перейдёт к secondary/primary.
 */
export const KNOWLEDGE_CLONE_EXTRACT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['categories', 'experienceHighlights'],
  properties: {
    categories: {
      type: 'array',
      maxItems: 30,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'name',
          'confidence',
          'observationCount',
          'sampleStatements',
          'relatedEntityIds',
          'lastObservedAt',
        ],
        properties: {
          name: { type: 'string', minLength: 2, maxLength: 200 },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
          observationCount: { type: 'integer', minimum: 1, maximum: 1_000 },
          sampleStatements: {
            type: 'array',
            maxItems: 3,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['quote', 'blockId'],
              properties: {
                quote: { type: 'string', minLength: 2, maxLength: 600 },
                blockId: { type: 'string', minLength: 1, maxLength: 64 },
              },
            },
          },
          relatedEntityIds: {
            type: 'array',
            maxItems: 20,
            items: { type: 'string', minLength: 1, maxLength: 64 },
          },
          lastObservedAt: { type: 'string', minLength: 10, maxLength: 40 },
        },
      },
    },
    experienceHighlights: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'blockIds'],
        properties: {
          summary: { type: 'string', minLength: 5, maxLength: 400 },
          blockIds: {
            type: 'array',
            maxItems: 10,
            items: { type: 'string', minLength: 1, maxLength: 64 },
          },
        },
      },
    },
  },
};

export const KNOWLEDGE_CLONE_EXTRACT_SCHEMA_NAME = 'knowledge_clone_extract_v1';
