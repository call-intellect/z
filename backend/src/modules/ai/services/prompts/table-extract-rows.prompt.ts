/**
 * Smart-tables auto-creation (2026-06-02, Фаза 3) — Event-to-Cells, extract.
 *
 * LLM-промпт `table-extract-rows` (cheap tier — DeepSeek V4 Flash). По
 * транскрипту встречи и схеме НЕ-readonly колонок sync-таблицы извлекает факты,
 * которыми можно заполнить ячейки строки конкретной сущности (entityLabel).
 *
 * Cache-friendly: SYSTEM стабилен, переменное в USER (Б10). SYSTEM держит роль +
 * каталог типов колонок + ЖЁСТКОЕ правило «только прямо названные факты, иначе
 * не возвращай». USER — схема колонок + entityLabel + фрагмент транскрипта.
 *
 * Выход — JSON object:
 *   { facts: [{ propertyId, value, confidence: 0..1, quote, timeSec }] }
 */

import { withInjectionGuard } from './common';

/**
 * Каталог типов колонок для подсказки модели, как форматировать `value`.
 * Совпадает по значениям с `TablePropType` (без системных авто-типов и без
 * структурных relation/rollup/file — их агент из транскрипта не извлекает).
 */
const EXTRACT_COLUMN_TYPE_CATALOG: ReadonlyArray<[type: string, ru: string]> = [
  ['text', 'короткая строка'],
  ['longtext', 'длинный текст / заметка'],
  ['number', 'число (верни как число)'],
  ['currency', 'денежная сумма (верни число в рублях)'],
  ['percent', 'процент (верни число 0..100)'],
  ['date', 'дата в формате ГГГГ-ММ-ДД'],
  ['status', 'один из допустимых статусов колонки'],
  ['selectSingle', 'одно значение из набора'],
  ['selectMulti', 'массив значений из набора'],
  ['checkbox', 'да/нет (true/false)'],
  ['url', 'ссылка (адрес сайта)'],
  ['email', 'электронная почта'],
  ['phone', 'телефон'],
];

export interface ExtractRowsPropertySchemaItem {
  /** id колонки (TableProperty.id) — модель обязана вернуть факт именно по нему. */
  id: string;
  /** Человекочитаемое имя колонки. */
  name: string;
  /** Тип колонки (TablePropType). */
  type: string;
  /** Опц. описание/подсказка по колонке. */
  hint?: string;
}

export interface BuildTableExtractRowsPromptArgs {
  /** Схема НЕ-readonly колонок строки (переменная часть, в USER). */
  propertySchema: ReadonlyArray<ExtractRowsPropertySchemaItem>;
  /** Фрагмент транскрипта встречи (переменная часть, в USER). */
  transcriptChunk: string;
  /** Метка сущности, к которой относится строка («ООО Бета-Корп»). */
  entityLabel: string;
}

function buildSystem(): string {
  const typeLines = EXTRACT_COLUMN_TYPE_CATALOG.map(
    ([t, ru]) => `  - \`${t}\` — ${ru}`,
  ).join('\n');

  return withInjectionGuard(
    [
      // Cache-friendly: SYSTEM стабилен, переменное в USER (Б10).
      'Ты извлекаешь факты для колонок таблицы СТРОГО из транскрипта встречи. Тебе дают схему колонок (id, название, тип), метку сущности и фрагмент транскрипта. Твоя задача — вернуть значения только тех колонок, факт по которым ПРЯМО назван в транскрипте применительно к указанной сущности.',
      '',
      '## Типы колонок (как форматировать value)',
      typeLines,
      '',
      '## Жёсткие правила',
      '- Возвращай значение колонки ТОЛЬКО если соответствующий факт прямо назван в транскрипте. Если факт не упомянут или ты не уверен — НЕ возвращай эту колонку. Лучше пропустить, чем выдумать.',
      '- Никогда не додумывай, не обобщай и не выводи значение «по смыслу» — только то, что явно сказано.',
      '- Каждый факт относится к указанной сущности (entityLabel). Факты про других участников/компании не возвращай.',
      '- `confidence` (0..1) — насколько явно факт назван: 0.9+ если сказано дословно и однозначно; 0.6-0.8 если есть лёгкая неоднозначность; ниже 0.6 если сомнительно.',
      '- `quote` — короткая дословная цитата из транскрипта, подтверждающая факт.',
      '- `timeSec` — момент (в секундах) начала реплики-источника, если он известен из транскрипта; иначе 0.',
      '- `propertyId` — ровно тот `id` колонки из схемы, к которой относится факт. Чужие id не выдумывай.',
      '',
      '## Формат вывода',
      'Верни СТРОГО валидный JSON-объект без markdown-обёрток и комментариев:',
      '`{ "facts": [ { "propertyId": string, "value": string|number|boolean|array, "confidence": number, "quote": string, "timeSec": number } ] }`',
      'Если в транскрипте нет ни одного подтверждённого факта по колонкам — верни `{ "facts": [] }`.',
    ].join('\n'),
  );
}

// SYSTEM не зависит от данных — собираем один раз (стабильный prefix для кэша).
const SYSTEM = buildSystem();

/**
 * Возвращает `{ system, user }`. SYSTEM стабилен (кэшируется), переменные
 * данные (схема + entityLabel + транскрипт) идут в USER.
 */
export function buildTableExtractRowsPrompt(
  args: BuildTableExtractRowsPromptArgs,
): { system: string; user: string } {
  const schemaLines = args.propertySchema
    .map(
      (p) =>
        `  - id=${p.id} | «${p.name}» | тип ${p.type}${p.hint ? ` | ${p.hint}` : ''}`,
    )
    .join('\n');

  const user = [
    `Сущность (строка таблицы): ${args.entityLabel}`,
    '',
    'Колонки, которые можно заполнить:',
    schemaLines || '  (нет колонок)',
    '',
    'Фрагмент транскрипта встречи:',
    args.transcriptChunk.trim(),
    '',
    'Верни JSON по правилам из системного сообщения. Возвращай только прямо подтверждённые факты.',
  ].join('\n');

  return { system: SYSTEM, user };
}
