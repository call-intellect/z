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
