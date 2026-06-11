/**
 * Smart-tables auto-creation (2026-06-02, Фаза 3) — Event-to-Cells, single cell.
 *
 * LLM-промпт `table-auto-fill` (cheap tier — DeepSeek V4 Flash). Рекомендация
 * значения для ОДНОЙ ячейки строки по фрагменту транскрипта и контексту строки.
 * Используется точечно (например, при ручном «подскажи значение из встречи»),
 * в отличие от `table-extract-rows`, который извлекает факты сразу по всем
 * колонкам строки.
 *
 * Cache-friendly: SYSTEM стабилен, переменное в USER (Б10). SYSTEM держит роль +
 * правило «только прямо названный факт, иначе null». USER — описание колонки +
 * контекст строки + фрагмент транскрипта.
 *
 * Выход — JSON object:
 *   { value: string|number|boolean|array|null, confidence: 0..1, quote, timeSec }
 */

import { withInjectionGuard, wrapUserData } from './common';

export interface AutoFillPropertyDescriptor {
  /** id колонки (TableProperty.id). */
  id: string;
  /** Человекочитаемое имя колонки. */
  name: string;
  /** Тип колонки (TablePropType). */
  type: string;
  /** Опц. подсказка/описание ожидаемого значения. */
  hint?: string;
}

export interface BuildTableAutoFillPromptArgs {
  /** Описание целевой колонки (переменная часть, в USER). */
  property: AutoFillPropertyDescriptor;
  /**
   * Контекст строки: уже известные ячейки в человекочитаемом виде
   * (`Название: ООО Бета-Корп; Стадия: переговоры`). Переменная часть, в USER.
   */
  rowContext: string;
  /** Фрагмент транскрипта встречи (переменная часть, в USER). */
  transcriptChunk: string;
}

function buildSystem(): string {
  return withInjectionGuard(
    [
      // Cache-friendly: SYSTEM стабилен, переменное в USER (Б10).
      'Ты подбираешь значение для ОДНОЙ ячейки таблицы СТРОГО из транскрипта встречи. Тебе дают описание колонки, контекст строки (уже известные значения) и фрагмент транскрипта. Верни значение колонки только если факт ПРЯМО назван в транскрипте.',
      '',
      '## Жёсткие правила',
      '- Если факт прямо не назван в транскрипте или ты не уверен — верни `value: null`. Лучше null, чем выдумка.',
      '- Никогда не додумывай и не выводи значение «по смыслу» — только то, что явно сказано.',
      '- Формат value соответствует типу колонки: число для number/currency/percent; ГГГГ-ММ-ДД для date; true/false для checkbox; строка для text/longtext/url/email/phone; одно из допустимых значений для status/selectSingle; массив для selectMulti.',
      '- `confidence` (0..1) — насколько явно факт назван. При `value: null` верни `confidence: 0`.',
      '- `quote` — короткая дословная цитата-подтверждение (пустая строка при null).',
      '- `timeSec` — секунда начала реплики-источника, если известна; иначе 0.',
      '',
      '## Формат вывода',
      'Верни СТРОГО валидный JSON-объект без markdown-обёрток и комментариев:',
      '`{ "value": string|number|boolean|array|null, "confidence": number, "quote": string, "timeSec": number }`',
    ].join('\n'),
  );
}

// SYSTEM не зависит от данных — собираем один раз (стабильный prefix для кэша).
const SYSTEM = buildSystem();

/**
 * Возвращает `{ system, user }`. SYSTEM стабилен (кэшируется), переменные
 * данные (колонка + контекст строки + транскрипт) идут в USER.
 */
export function buildTableAutoFillPrompt(
  args: BuildTableAutoFillPromptArgs,
): { system: string; user: string } {
  const p = args.property;
  const user = [
    `Колонка: id=${p.id} | «${p.name}» | тип ${p.type}${p.hint ? ` | ${p.hint}` : ''}`,
    '',
    'Контекст строки (уже известные значения):',
    args.rowContext.trim() || '  (пусто)',
    '',
    'Фрагмент транскрипта встречи:',
    // Сырой транскрипт встречи — оборачиваем в маркеры данных (anti-injection).
    // SYSTEM держит INJECTION_GUARD_NOTE через withInjectionGuard выше.
    // rowContext выше — derived (собран нашим кодом из ячеек строки), не оборачиваем.
    wrapUserData(args.transcriptChunk.trim()),
    '',
    'Верни JSON по правилам из системного сообщения. Если факт не назван прямо — value: null.',
  ].join('\n');

  return { system: SYSTEM, user };
}
