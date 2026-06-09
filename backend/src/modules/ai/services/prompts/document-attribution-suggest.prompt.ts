/**
 * ТЗ-4 Ф10 (manual-document-upload) — document-attribution-suggest.
 *
 * LLM-промпт `document-attribution-suggest` (cheap-tier — DeepSeek V4 Flash). По
 * фрагменту текста загруженного документа и списку тем графа знаний Org предлагает
 * атрибуцию: смысловой тип документа (`DocumentType`) + наиболее подходящую тему
 * (`themeId` или null) + confidence. Результат записывается в
 * `Document.suggestedDocType` / `Document.suggestedThemeId` — НЕ применяется
 * автоматически: человек подтверждает/правит в UI (Р3, human-in-the-loop).
 *
 * ── Совместимость с prompt caching ──
 * SYSTEM СТАБИЛЕН (инструкция классификатора + фиксированный каталог типов
 * `DocumentType` + фиксированная JSON-форма вывода + правила) — собирается один
 * раз как модульная константа и не зависит от данных. Все ПЕРЕМЕННЫЕ данные
 * (фрагмент текста документа + список тем Org) идут в КОНЦЕ user-сообщения. Это
 * даёт стабильный prefix → 95-99% cache-hit у DeepSeek/OpenAI-proxy
 * (memory `feedback_llm_prompts_cache_friendly`). НИКОГДА не класть текст
 * документа или темы в SYSTEM.
 */

import { withInjectionGuard, wrapUserData } from './common';

/**
 * Каталог смысловых типов документа — ФИКСИРОВАННЫЙ enum `DocumentType`
 * (schema.prisma). Совпадает 1:1 со значениями enum'а; источник правды — Prisma.
 * Здесь — текстовое описание для модели (в SYSTEM, стабильно).
 */
export const DOC_TYPE_CATALOG: ReadonlyArray<string> = [
  '`regulation` — регламент: обязательные правила/нормы выполнения работы.',
  '`policy` — политика: принципы и рамки (что можно/нельзя), без пошаговости.',
  '`instruction` — инструкция: пошаговое руководство «как сделать X».',
  '`process` — описание процесса: последовательность этапов с входами/выходами.',
  '`job_description` — должностная инструкция: обязанности и зона ответственности роли.',
  '`other` — прочее: не подходит ни под один тип выше.',
];

/** Один вариант темы графа знаний Org для подсказки модели (переменная часть, в USER). */
export interface AttributionThemeOption {
  /** Theme.id — модель обязана брать themeId ТОЛЬКО отсюда. */
  id: string;
  /** Человекочитаемое имя темы. */
  name: string;
}

export interface BuildDocumentAttributionPromptArgs {
  /** Фрагмент распарсенного текста документа (переменная часть, в USER). Уже усечён caller'ом. */
  textExcerpt: string;
  /** Список тем графа знаний Org (переменная часть, в USER). Может быть пустым. */
  themes: ReadonlyArray<AttributionThemeOption>;
}

function buildSystem(): string {
  const typeLines = DOC_TYPE_CATALOG.map((l) => `  - ${l}`).join('\n');

  return withInjectionGuard(
    [
      // Cache-friendly: SYSTEM стабилен (инструкция + каталог типов + правила +
      // JSON-форма), переменное (текст документа + темы Org) — в КОНЦЕ user.
      'Ты классифицируешь загруженный в память компании документ. Тебе дают фрагмент текста документа и список тем графа знаний компании (id, название). Определи смысловой тип документа и наиболее подходящую тему. Это ПОДСКАЗКА — человек её подтвердит или поправит, поэтому не выдумывай: при сомнении ставь `other` и/или `themeId: null` и понижай confidence.',
      '',
      '## Каталог смысловых типов документа (выбери ровно один)',
      typeLines,
      '',
      '## Жёсткие правила',
      '- `docType` — ТОЛЬКО одно из значений каталога выше. Никогда не выдумывай новые типы.',
      '- `themeId` бери ТОЛЬКО из переданного списка тем (по полю id). Если ни одна тема не подходит или список тем пуст — верни `themeId: null`. Никогда не выдумывай id.',
      '- `confidence` — число от 0 до 1 (твоя уверенность в `docType`). При явном совпадении ~0.85+, при догадке ~0.4-0.6, при отсутствии сигнала ≤0.3.',
      '- Опирайся ТОЛЬКО на переданный текст и список тем. Не используй внешние знания.',
      '- Не добавляй пояснений и текста вокруг JSON.',
      '',
      '## Формат вывода',
      'Верни СТРОГО валидный JSON-объект без markdown-обёрток и комментариев:',
      '`{ "docType": "regulation|policy|instruction|process|job_description|other", "themeId": string|null, "confidence": number }`',
    ].join('\n'),
  );
}

// SYSTEM не зависит от данных — собираем один раз (стабильный prefix для кэша).
const SYSTEM = buildSystem();

/**
 * Возвращает `{ system, user }`. SYSTEM стабилен (кэшируется), переменные данные
 * (список тем Org + фрагмент текста документа) идут в КОНЕЦ user. Текст документа
 * обёрнут в маркеры данных (защита от prompt-injection).
 */
export function buildDocumentAttributionPrompt(
  args: BuildDocumentAttributionPromptArgs,
): { system: string; user: string } {
  const themeLines = args.themes
    .map((t) => `  - id=${t.id} | «${t.name}»`)
    .join('\n');

  const user = [
    'Темы графа знаний компании (выбирай themeId ТОЛЬКО отсюда):',
    themeLines || '  (тем нет — верни themeId: null)',
    '',
    'Фрагмент текста документа:',
    wrapUserData(args.textExcerpt.trim()),
    '',
    'Верни JSON-подсказку атрибуции по правилам из системного сообщения.',
  ].join('\n');

  return { system: SYSTEM, user };
}
