/**
 * DeterministicCleaner — уровень 1 очистки транскрипта.
 *
 * Источник: plans/tz/2026-05-21-phase-D-transcript-cleaning.md §2 + §6.1.
 *
 * Pure-функции (никакой DI, никакой IO). Применяется в воркере
 * `ai.transcript-clean.worker` ДО опционального уровня 2 (LLM-refine).
 *
 * Алгоритм по сегменту:
 *   1. Если segment.text целиком состоит из одиночного междометия
 *      (без других слов) — segment удаляется (sourceIndex остаётся в mapping'е,
 *      но cleanedText = '' и segment не попадает в финальный массив cleaned).
 *   2. Иначе по тексту проходим словарём filler-слов (regex с word boundary,
 *      регистронезависимо), удаляем слово + соседнюю пунктуацию-«паузу».
 *   3. Сжимаем повторы 2-3 одинаковых слов подряд («ну ну ну» → «ну»;
 *      «то-есть то-есть» → «то-есть»).
 *   4. Сжимаем повторяющиеся пары слов («давайте давайте давайте» уже на (3),
 *      «то есть то есть» — фраза из 2 слов, ловится отдельной passes).
 *   5. Нормализуем пробелы и запятые-пустышки.
 *
 * НЕ делаем (намеренно):
 *   - орфографию, пунктуацию (ASR Vox уже это сделал);
 *   - перестановку слов;
 *   - удаление содержательных слов даже «корявой» речи;
 *   - удаление односимвольных «а», «и», «о» как междометий — это связки.
 *
 * Это уровень 1. Контекстные «ну» (связка vs паразит), false-starts с
 * маркерами «то есть, я хотел сказать» — отдаём уровню 2 (LLM).
 */

import type { DialogTurn } from './prompts/common';

/**
 * Словарь чистых filler-слов (всегда удаляются, если стоят отдельным словом
 * с word-boundary). По нему гоняется regex `\b(word)\b` с флагом `iu`.
 *
 * Источник списка — §2 sub-TZ D. Дополнения сюда добавляются осторожно
 * (любое слово может оказаться значимым в каком-то контексте).
 *
 * НЕ включены сюда:
 *   - «ну» — слишком часто значимая связка, отдаём в LLM-refine;
 *   - «вот» — может быть указательным («вот этот вопрос»);
 *   - «короче» — может быть просьбой «сократи»;
 *   - «значит» — может быть логической связкой.
 * Эти 4 слова кандидаты на уровне 2.
 */
const FILLER_DICTIONARY: readonly string[] = [
  'эээ',
  'эээээ',
  'эээээээ',
  'эээ-эээ',
  'ээ',
  'ммм',
  'мммм',
  'ммммм',
  'эмм',
  'эмммм',
  'эээм',
  'мм',
  'ам',
  'кхм',
  'кхе',
  'кхэ',
  'эх',
  'охх',
  'ох',
  'кх',
  'хм',
  'хмм',
  'хмммм',
  'мхм',
  // Связки-паразиты, чаще всего без смысла:
  'типа',
  'как-бы',
  'как бы',
  'это-самое',
  'это самое',
  'так-сказать',
  'так сказать',
  'в-общем',
  'в-принципе',
  'в общем',
  'в принципе',
];

/**
 * Словарь «одиночных междометий» — если segment целиком из этих токенов и
 * пунктуации (и больше ничего), segment удаляется. Список умышленно узкий.
 *
 * NB: «да»/«нет» НЕ включены — это содержательные ответы.
 */
const STANDALONE_INTERJECTIONS: readonly string[] = [
  'ага',
  'угу',
  'м-м',
  'м-м-м',
  'мм-м',
  'хм',
  'хмм',
  'мхм',
  'ну-у',
  'нуу',
  'нууу',
  'эээ',
  'ээ',
  'ммм',
  'мм',
];

/**
 * Один removed-item для `cleaned.json#segments[].removed[]`.
 */
export interface CleanerRemovedItem {
  type: 'filler' | 'repeat' | 'false_start';
  text: string;
}

/**
 * Один очищенный сегмент. Соответствует §5 sub-TZ D с
 * именами полей: `originalIndex`, `participantIdentity`,
 * `startMs`, `endMs`, `originalText`, `cleanedText`, `removed`.
 */
export interface CleanedSegment {
  originalIndex: number;
  participantIdentity: string;
  startMs: number;
  endMs: number;
  originalText: string;
  cleanedText: string;
  removed: CleanerRemovedItem[];
}

export interface CleanerInputSegment {
  participantIdentity: string;
  startMs: number;
  endMs: number;
  text: string;
}

export interface CleanerStats {
  fillerWordsRemoved: number;
  repeatsRemoved: number;
  falseStartsRemoved: number;
  charsBefore: number;
  charsAfter: number;
}

export interface CleanerResult {
  segments: CleanedSegment[];
  stats: CleanerStats;
}

/**
 * Главный entry-point. Принимает массив сырых сегментов (одни сегмент =
 * один turn после merge.worker'а), возвращает cleaned-сегменты + stats.
 *
 * Сегменты, чей `cleanedText` пустой (стало быть, в нём были только filler'ы
 * или одиночные междометия), в финальный массив попадают тоже — с пустой
 * строкой и помеченные `removed`. Это нужно, чтобы UI смог скрыть их через
 * фильтр `cleanedText.length > 0`, но при этом mapping originalIndex → time
 * остался полным для видео-скроллера.
 */
export function deterministicClean(segments: readonly CleanerInputSegment[]): CleanerResult {
  let fillerWordsRemoved = 0;
  let repeatsRemoved = 0;
  const falseStartsRemoved = 0; // на уровне 1 false-start'ы не трогаем
  let charsBefore = 0;
  let charsAfter = 0;

  const cleaned: CleanedSegment[] = segments.map((seg, idx) => {
    const original = seg.text;
    charsBefore += original.length;
    const removed: CleanerRemovedItem[] = [];

    // 1) Standalone interjection — segment чисто из междометий?
    if (isStandaloneInterjection(original)) {
      removed.push({ type: 'filler', text: original.trim() });
      fillerWordsRemoved += 1;
      return {
        originalIndex: idx,
        participantIdentity: seg.participantIdentity,
        startMs: seg.startMs,
        endMs: seg.endMs,
        originalText: original,
        cleanedText: '',
        removed,
      };
    }

    // 2) Filler dictionary pass.
    let working = original;
    const fillerHits = removeFillerWords(working);
    working = fillerHits.text;
    fillerWordsRemoved += fillerHits.count;
    for (const w of fillerHits.removedWords) {
      removed.push({ type: 'filler', text: w });
    }

    // 3) Repeats pass — 2..3 одинаковых слова подряд.
    const repeatHits = collapseRepeats(working);
    working = repeatHits.text;
    repeatsRemoved += repeatHits.count;
    for (const w of repeatHits.removedWords) {
      removed.push({ type: 'repeat', text: w });
    }

    // 4) Normalize whitespace + dangling punctuation.
    working = normalizeWhitespace(working);

    charsAfter += working.length;

    return {
      originalIndex: idx,
      participantIdentity: seg.participantIdentity,
      startMs: seg.startMs,
      endMs: seg.endMs,
      originalText: original,
      cleanedText: working,
      removed,
    };
  });

  return {
    segments: cleaned,
    stats: {
      fillerWordsRemoved,
      repeatsRemoved,
      falseStartsRemoved,
      charsBefore,
      charsAfter,
    },
  };
}

/**
 * Конвертер DialogTurn (merge.worker output) → CleanerInputSegment.
 * Сегменты сохраняют исходный порядок — это критично для mapping'а тайм-кодов.
 *
 * `participantIdentity` берём из `speaker` (это denormalized имя из merger.ts).
 */
export function turnsToCleanerInput(turns: readonly DialogTurn[]): CleanerInputSegment[] {
  return turns.map((t) => ({
    participantIdentity: t.speaker,
    startMs: Math.round(t.startSec * 1000),
    endMs: Math.round(t.endSec * 1000),
    text: t.text,
  }));
}

// ─────────────────────────── helpers ─────────────────────────────────────

/**
 * Проверка «весь segment — одни междометия + пунктуация».
 * `Это`, `мм Мхм` → true. `Да, понял` → false.
 */
function isStandaloneInterjection(text: string): boolean {
  const stripped = text
    .toLowerCase()
    .replace(/[.,!?;:()«»"'\-—–]/g, ' ')
    .trim();
  if (stripped.length === 0) return false;
  const tokens = stripped.split(/\s+/);
  if (tokens.length > 3) return false; // длинный segment почти наверняка содержит смысл
  return tokens.every((tok) => STANDALONE_INTERJECTIONS.includes(tok));
}

/**
 * Удаляет filler-слова из словаря. Возвращает обновлённый текст и список того,
 * что удалили. Word boundary гарантирует, что мы не сожрём «эммигрант» из-за
 * «эмм» — слова должны быть «целые».
 *
 * Сначала идём по multi-word (фразы вроде «как бы», «в принципе») —
 * иначе бы «бы» застряло в обработке. Затем — по одиночным словам.
 */
function removeFillerWords(text: string): { text: string; count: number; removedWords: string[] } {
  let result = text;
  let count = 0;
  const removed: string[] = [];

  // Unicode-границы: вместо `\b` (ASCII-only) используем lookahead/lookbehind
  // по unicode property L (буква). Это ловит кириллицу корректно.
  // Граница = «не-буква» либо начало/конец строки.
  const startBoundary = '(?<![\\p{L}\\p{N}])';
  const endBoundary = '(?![\\p{L}\\p{N}])';

  // multi-word phrases first (с пробелом или дефисом)
  const multiWord = FILLER_DICTIONARY.filter((w) => /\s|-/.test(w));
  for (const phrase of multiWord) {
    const re = new RegExp(`${startBoundary}${escapeRegex(phrase)}${endBoundary}`, 'giu');
    const matches = result.match(re);
    if (matches && matches.length > 0) {
      count += matches.length;
      removed.push(...matches);
      result = result.replace(re, ' ');
    }
  }

  // single word fillers
  const singleWord = FILLER_DICTIONARY.filter((w) => !/\s|-/.test(w));
  for (const word of singleWord) {
    const re = new RegExp(`${startBoundary}${escapeRegex(word)}${endBoundary}`, 'giu');
    const matches = result.match(re);
    if (matches && matches.length > 0) {
      count += matches.length;
      removed.push(...matches);
      result = result.replace(re, ' ');
    }
  }

  return { text: result, count, removedWords: removed };
}

/**
 * Сжимает 2-3 идентичных слова подряд в одно. Например:
 *   - «я я я думаю» → «я думаю» (2 удалены, removed=['я','я']).
 *   - «то-есть то-есть» → «то-есть».
 *   - «давайте давайте давайте давайте» → «давайте» (3 удалены).
 *
 * Регистр сохраняется в первом вхождении. Слова кириллицы + латиницы.
 */
function collapseRepeats(text: string): {
  text: string;
  count: number;
  removedWords: string[];
} {
  // Используем Unicode property escapes для русских/латинских слов (\p{L}).
  // Группа 1 — слово; `(?:\s+\1)+` — один или более повторов того же слова
  // подряд. Жадный квантификатор схлопывает любое количество подряд (4, 5, …)
  // в одно слово за один проход. Финальный (?![\p{L}\p{N}]) — unicode-граница
  // (\b в JS RegExp не работает на кириллице).
  const re = /(\p{L}[\p{L}-]*)(?:\s+\1)+(?![\p{L}\p{N}])/giu;
  let count = 0;
  const removed: string[] = [];
  const out = text.replace(re, (full, word: string) => {
    // Считаем, сколько слов в полном матче, минус 1 (первое оставляем).
    const tokens = full.trim().split(/\s+/).length;
    const dropped = tokens - 1;
    count += dropped;
    for (let i = 0; i < dropped; i++) removed.push(word);
    return word;
  });
  return { text: out, count, removedWords: removed };
}

/**
 * Нормализация после filler-проходов: двойные пробелы, пробелы перед знаками
 * пунктуации, висячие запятые. ASR может оставлять «эээ, но» → после filler
 * это становится «, но» — убираем ведущую запятую.
 */
function normalizeWhitespace(text: string): string {
  return text
    .replace(/\s+/g, ' ') // схлоп множественных пробелов
    .replace(/\s+([,.!?;:])/g, '$1') // пробел перед пунктуацией
    .replace(/^[,;:\s]+/, '') // ведущая запятая/пробел
    .replace(/([,;:])\s*([,;:])/g, '$1') // двойные знаки подряд («, , но»)
    .trim();
}

/**
 * Escape для regex (нет в стандартной библиотеке JS до Stage 3).
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
