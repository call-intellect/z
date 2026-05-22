/**
 * Code-fallback промпта `transcript-clean-refine` (sub-TZ D §6.3).
 *
 * Используется через `PromptResolverService` (Фаза A.1) с фоллбеком на
 * этот файл, если в БД нет активного шаблона или БД недоступна.
 *
 * Назначение: уровень 2 очистки — LLM-уточнение filler / repeat / false-start
 * для сегментов, которые не сжал детерминистский уровень 1. На вход подаём
 * чанк из 5–10 segment'ов; на выход ждём массив {originalIndex, cleanedText,
 * removed}.
 *
 * Ключевые правила (§6.3 промпта):
 *   1. НЕ меняем содержательную речь даже если она корявая.
 *   2. НЕ исправляем орфографию/пунктуацию — ASR Vox уже это сделал.
 *   3. Сохраняем стиль и эмоции говорящего.
 *   4. Удаляем только: filler-слова, дословные повторы, false starts с
 *      маркером «то есть, я хотел сказать, короче».
 *   5. Сохраняем риторические вопросы вида «ну? и что?» — это связки.
 */

export const TRANSCRIPT_CLEAN_REFINE_TOOL_NAME = 'refine_segments' as const;

export const TRANSCRIPT_CLEAN_REFINE_SYSTEM_PROMPT = `Ты — редактор-корректор русскоязычных транскриптов встреч.

На входе — массив сегментов диалога. По каждому сегменту верни «очищенный» текст: без слов-паразитов, дословных повторов и false starts.

ПРАВИЛА:
1. НЕ меняй содержательную речь, даже если она корявая или с разговорными конструкциями.
2. НЕ исправляй орфографию или пунктуацию — ASR уже это сделал.
3. Сохраняй стиль и эмоции говорящего. Не превращай «ВОТ ЭТО я понимаю» в «это понимаю».
4. Удаляй ТОЛЬКО:
   - Слова-паразиты без смысла: «ну», «вот», «короче», «значит», «то есть» (когда не связка), «как бы».
   - Дословные повторы: «то есть то есть», «давайте давайте».
   - False starts: «Я хотел сказать… то есть, я думаю, что…» → оставь только «Я думаю».
5. СОХРАНЯЙ как есть:
   - Риторические вопросы «ну?», «и что?», «правда?».
   - Числа, имена, цифры, ID — никаких изменений.
   - Профессиональный жаргон и термины.

Вызови инструмент \`${TRANSCRIPT_CLEAN_REFINE_TOOL_NAME}\` с массивом результатов. Не возвращай свободный текст.`;

/**
 * JSON Schema для output (для tool-use). Используется через
 * `LlmRouterService.call` с `responseFormat={ type:'json_schema', ... }`.
 */
export const TRANSCRIPT_CLEAN_REFINE_OUTPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          originalIndex: { type: 'integer' },
          cleanedText: { type: 'string' },
          removed: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['filler', 'repeat', 'false_start'],
                },
                text: { type: 'string' },
              },
              required: ['type', 'text'],
              additionalProperties: false,
            },
          },
        },
        required: ['originalIndex', 'cleanedText', 'removed'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

/**
 * Строит user-сообщение для LLM. Сегменты подаются как JSON-массив,
 * чтобы модели было максимально просто связать originalIndex.
 */
export function buildTranscriptCleanRefineUserMessage(
  segments: Array<{
    originalIndex: number;
    speaker: string;
    text: string;
  }>,
): string {
  const items = segments.map((s) => ({
    originalIndex: s.originalIndex,
    speaker: s.speaker,
    text: s.text,
  }));
  return `Сегменты для очистки:\n\n${JSON.stringify(items, null, 2)}`;
}
