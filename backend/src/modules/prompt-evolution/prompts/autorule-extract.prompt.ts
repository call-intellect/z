/**
 * Agents v2 Фаза B1 (2026-05-30) — AutoRule extract.
 *
 * Анализирует группу пар (original, edited) AI-output'ов и выводит ОДНО
 * консистентное правило, отличающее edited от original. Игнорирует
 * опечатки/перестановки слов. Фокус на: что добавили, что убрали, какой
 * структуры стало больше.
 *
 * Результат — JSON по схеме `autorule_extract_v1`:
 *   {
 *     rule: string,               // human-readable, ≤200 символов, на русском
 *     ruleType: 'must_do' | 'must_not_do' | 'tone' | 'structure',
 *     confidence: number 0..1,
 *     examples: Array<{originalSnippet, editedSnippet, why}>, // 1..3
 *     reasoning: string            // почему именно это правило
 *   }
 *
 * В Фазе B (shadow) правила НЕ инъектируются в промпты — только записываются
 * в `PromptRule(status='shadow')` для последующей валидации админом.
 *
 * Совместимость с prompt caching (см. second-brain/02_architecture/llm-cache-status.md):
 *   - SYSTEM стабилен → cache hit у DeepSeek/OpenAI-via-proxy с экономией ≈99%.
 *   - Все переменные (promptKey + список пар) — в конце USER.
 *   - Шаблон USER начинается с фиксированного префикса; пары добавляются
 *     последним блоком.
 */

export const AUTORULE_EXTRACT_SYSTEM_PROMPT = [
  'Ты — Кора. Тебе дают пары (original, edited) AI-output\'ов одного типа.',
  'Найди ОДНО консистентное правило, по которому edited отличается от original.',
  'Игнорируй: опечатки, перестановки слов, мелкие синонимы.',
  'Сосредоточься: что пользователь систематически ДОБАВЛЯЕТ, что УБИРАЕТ, какой структуры становится БОЛЬШЕ.',
  'Не выдумывай правила, которых нет в данных. Если паттерн неочевиден — confidence низкий.',
  'Категории правил:',
  '  - must_do: что AI должен делать (например «всегда добавлять список действий»).',
  '  - must_not_do: что AI должен НЕ делать (например «не использовать эмодзи»).',
  '  - tone: стиль/тон (например «более прямой, без вводных»).',
  '  - structure: формат вывода (например «отчёт начинать с TL;DR»).',
  'Верни JSON строго по схеме autorule_extract_v1на русском.',
].join('\n');

export interface AutoRuleExtractExample {
  original: string;
  edited: string;
}

/**
 * Формирует USER-сообщение из списка пар. Переменные данные — в конце,
 * чтобы префикс USER оставался стабильным между разными группами одного
 * `promptKey` (cache hit).
 */
export const AUTORULE_EXTRACT_USER_TEMPLATE = (args: {
  promptKey: string;
  examples: AutoRuleExtractExample[];
}): string => {
  const header = [
    'Извлеки правило по парам (original, edited) для AI-промпта.',
    'Все пары — из одного типа задачи; правило должно объяснять консистентное отличие edited от original.',
    `Тип промпта: ${args.promptKey}`,
    `Пар: ${args.examples.length}`,
    '',
    'Пары (original → edited):',
  ].join('\n');

  const pairs = args.examples
    .map((p, i) => {
      const idx = i + 1;
      return [
        `--- Пара ${idx} ---`,
        `ORIGINAL: ${p.original}`,
        `EDITED: ${p.edited}`,
      ].join('\n');
    })
    .join('\n\n');

  return `${header}\n\n${pairs}\n\nВерни JSON по схеме autorule_extract_v1.`;
};

export const AUTORULE_EXTRACT_SCHEMA_NAME = 'autorule_extract_v1';

export const AUTORULE_EXTRACT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['rule', 'ruleType', 'confidence', 'examples', 'reasoning'],
  properties: {
    rule: {
      type: 'string',
      minLength: 5,
      maxLength: 200,
      description:
        'Человеко-читаемая формулировка правила на русском (≤200 символов). Например «Всегда добавлять короткий список Action Items в конце».',
    },
    ruleType: {
      type: 'string',
      enum: ['must_do', 'must_not_do', 'tone', 'structure'],
      description:
        'Категория правила: must_do — что AI должен делать; must_not_do — что НЕ делать; tone — стиль; structure — формат вывода.',
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description:
        'Уверенность в правиле: ≥0.85 — очень уверен; ≥0.7 — уверен; <0.7 — слабый сигнал, не следует промоутить.',
    },
    examples: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      description:
        '1–3 самых ярких примера из переданных пар, демонстрирующих правило.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['originalSnippet', 'editedSnippet', 'why'],
        properties: {
          originalSnippet: {
            type: 'string',
            minLength: 1,
            maxLength: 500,
            description:
              'Короткий фрагмент original-текста, который пользователь правил.',
          },
          editedSnippet: {
            type: 'string',
            minLength: 1,
            maxLength: 500,
            description:
              'Соответствующий фрагмент edited-текста (после правки).',
          },
          why: {
            type: 'string',
            minLength: 5,
            maxLength: 200,
            description:
              'Объяснение, почему этот пример демонстрирует правило (1–2 предложения).',
          },
        },
      },
    },
    reasoning: {
      type: 'string',
      minLength: 10,
      maxLength: 500,
      description:
        'Обоснование: почему именно это правило, какой паттерн ты увидел в группе.',
    },
  },
};
