/**
 * Промпт `reframing` — ночное переосмысление графа знания.
 *
 * Использует `ReframingCron` в два прохода для одного и того же `taskType`:
 *
 *  1. **analyzeFreshBlocks** — анализ свежих блоков за последние 7 дней:
 *     splitCandidates / mergeCandidates / themeShifts / общий analysis.
 *     System-промпт — `REFRAMING_BLOCKS_SYSTEM_PROMPT`,
 *     JSON Schema — `REFRAMING_BLOCKS_JSON_SCHEMA`.
 *  2. **reflectOnThemes** — рефлексия над активными Theme'ами:
 *     themeSplits / themeMerges / themesToArchive / analysis.
 *     System-промпт — `REFRAMING_THEMES_SYSTEM_PROMPT`,
 *     JSON Schema — `REFRAMING_THEMES_JSON_SCHEMA`.
 *
 * Вынесено из `workers/reframing.cron.ts` в рамках Фазы 8 §10 Find 2
 * (ТЗ 2026-05-25-llm-architecture-changes-from-experiments.md) — для
 * единообразия и admin-редактируемости.
 */

import { z } from 'zod';

// ─────────────────────────── blocks-проход ───────────────────────────────────

export const REFRAMING_BLOCKS_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['analysis'],
  properties: {
    analysis: { type: 'string', maxLength: 1000 },
    splitCandidates: {
      type: 'array',
      items: { type: 'string' },
    },
    mergeCandidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['a', 'b'],
        properties: {
          a: { type: 'string' },
          b: { type: 'string' },
        },
      },
    },
    themeShifts: {
      type: 'array',
      items: { type: 'string' },
    },
  },
};

export const ReframingBlocksResponseSchema = z.object({
  analysis: z.string().max(1000),
  splitCandidates: z.array(z.string()).optional(),
  mergeCandidates: z
    .array(
      z.object({
        a: z.string(),
        b: z.string(),
      }),
    )
    .optional(),
  themeShifts: z.array(z.string()).optional(),
});

export const REFRAMING_BLOCKS_SYSTEM_PROMPT = `Ты — аналитик, переосмысливающий граф знания компании.
На вход — список IdeaBlock'ов за последнюю неделю (имя + критический вопрос + доверенный ответ).

Твоя задача — найти ВЫСОКОУРОВНЕВЫЕ паттерны:
1. "splitCandidates" — id блоков, которые на самом деле смешивают две разные темы и стоит разделить.
2. "mergeCandidates" — пары id блоков (a, b), которые описывают одну и ту же идею и стоит слить.
3. "themeShifts" — короткие фразы, описывающие сдвиг фокуса (например, "стало больше про маркетинг, меньше про продукт").
4. "analysis" — общий вывод (1-2 абзаца): что компания обсуждала на этой неделе, какие тренды.

Правила:
- Не выдумывай. Если блоков мало или они разрозненные — просто короткий "analysis", остальные поля можно опустить.
- "analysis" — на русском, без markdown.
- При противоречии источников бери более позднее / актуальное; устаревшее считай заменённым, не смешивай старую и новую редакцию знания.
- Ответ — строго JSON по схеме.`;

// ─────────────────────────── themes-проход ───────────────────────────────────

/**
 * JSON Schema для шага 4 reframing'а — рефлексия над Theme'ами.
 * - themeSplits — id тем-кандидатов на разделение (ничего не делаем
 *   автоматически, только лог-сигнал — UI разберёт через owner Org).
 * - themeMerges — пары (sourceId, targetId): source становится merged_into target.
 * - themesToArchive — id тем, которые reframing считает устаревшими.
 */
export const REFRAMING_THEMES_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['analysis'],
  properties: {
    analysis: { type: 'string', maxLength: 1000 },
    themeSplits: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['themeId', 'reason'],
        properties: {
          themeId: { type: 'string' },
          reason: { type: 'string', maxLength: 500 },
        },
      },
    },
    themeMerges: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sourceId', 'targetId', 'reason'],
        properties: {
          sourceId: { type: 'string' },
          targetId: { type: 'string' },
          reason: { type: 'string', maxLength: 500 },
        },
      },
    },
    themesToArchive: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['themeId', 'reason'],
        properties: {
          themeId: { type: 'string' },
          reason: { type: 'string', maxLength: 500 },
        },
      },
    },
  },
};

export const ThemesReframingResponseSchema = z.object({
  analysis: z.string().max(1000),
  themeSplits: z
    .array(
      z.object({
        themeId: z.string(),
        reason: z.string().max(500),
      }),
    )
    .optional(),
  themeMerges: z
    .array(
      z.object({
        sourceId: z.string(),
        targetId: z.string(),
        reason: z.string().max(500),
      }),
    )
    .optional(),
  themesToArchive: z
    .array(
      z.object({
        themeId: z.string(),
        reason: z.string().max(500),
      }),
    )
    .optional(),
});

export const REFRAMING_THEMES_SYSTEM_PROMPT = `Ты — аналитик графа знаний компании. На вход — список активных Theme'ов (имя + описание + размер по числу блоков), плюс блоки за последнюю неделю, ещё не привязанные ни к одной теме.

Твоя задача — найти проблемы в текущей карте тем:
1. "themeSplits" — id тем, которые на самом деле смешивают две и более идеи и стоит разделить (пары / группы).
2. "themeMerges" — пары тем (sourceId, targetId), которые описывают одно и то же. source → merged_into target.
3. "themesToArchive" — темы, которые потеряли актуальность (нет новых блоков, описание устарело).
4. "analysis" — краткий вывод (1-2 абзаца), что наблюдается на этой неделе по теме мапы.

Правила:
- Не выдумывай. Если карта ровная — возвращай только analysis.
- Не предлагай объединять разные ветки компании.
- При противоречии источников бери более позднее / актуальное; устаревшую тему считай заменённой (themesToArchive), не смешивай старую и новую редакцию.
- Ответ — строго JSON по схеме.`;
