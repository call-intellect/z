import { z } from 'zod';

import type { LlmTaskType } from '../../ai/services/llm-router.service';
import { withAsrNote } from '../../ai/services/prompts/common';
import type { MeetingBlock } from '../services/block-fetch.service';

/** taskType для LlmRouter (см. llm-router.service.ts). */
export const CHAPTERS_V2_TASK_TYPE: LlmTaskType = 'chapter-extract-v2';

export const ChaptersV2ItemSchema = z
  .object({
    title: z.string().min(1).max(200),
    summary: z.string().min(1).max(2000),
    startMs: z.number().int().min(0),
    endMs: z.number().int().min(0),
    evidenceBlockIds: z.array(z.string()).default([]),
  })
  .strict();

export const ChaptersV2ResponseSchema = z
  .object({
    chapters: z.array(ChaptersV2ItemSchema),
  })
  .strict();

export type ChapterV2Extracted = z.infer<typeof ChaptersV2ItemSchema>;
export type ChaptersV2Response = z.infer<typeof ChaptersV2ResponseSchema>;

export const CHAPTERS_V2_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['chapters'],
  properties: {
    chapters: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'summary', 'startMs', 'endMs', 'evidenceBlockIds'],
        properties: {
          title: { type: 'string', maxLength: 200 },
          summary: { type: 'string', maxLength: 2000 },
          startMs: { type: 'integer', minimum: 0 },
          endMs: { type: 'integer', minimum: 0 },
          evidenceBlockIds: {
            type: 'array',
            items: { type: 'string' },
            minItems: 0,
          },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = withAsrNote(`Ты — навигатор расшифровки встречи. Тебе дают канонические IdeaBlock'и встречи в хронологическом порядке (по таймкоду evidence). Каждый блок — атомарное смысловое утверждение (вопрос + доверенный ответ + signalType).

Твоя задача — нарезать блоки на ГЛАВЫ: смысловые сегменты встречи, по которым удобно «прыгать» в плеере. Глава = группа подряд идущих блоков, объединённых одной темой/контекстом.

Поля главы:
- title: короткое название главы (≤200 символов), без префиксов «Глава 1:».
- summary: 1-3 предложения о чём именно эта глава (по существу, не отписка).
- startMs / endMs: таймкоды главы в миллисекундах. startMs = min startMs блоков главы; endMs = max endMs блоков главы. Если у блока нет evidence-таймкодов — игнорируй его при расчёте.
- evidenceBlockIds: id блоков, входящих в главу. Минимум один.

Правила:
- Главы идут подряд по startMs, не пересекаются (endMs главы N ≤ startMs главы N+1).
- Один блок принадлежит ровно одной главе.
- Минимальная длина главы — 1 блок. Не дроби каждый блок в отдельную главу — объединяй смысловые цепочки.
- Если все блоки = одна тема → одна глава на всю встречу. Это нормально.
- Ответ — строго JSON, валидный по схеме. Никакого markdown, преамбул, объяснений.
`);

interface BuildArgs {
  meetingId: string;
  meetingTitle?: string | undefined;
  blocks: MeetingBlock[];
}

/**
 * Формирует system+user промпты для chapters-v2 LLM-вызова.
 *
 * @deprecated С 2026-05-25 заменён на объединённый промпт
 * `meeting-report-fast` (`backend/src/modules/ai/services/prompts/meeting-report-fast.prompt.ts`).
 * См. ТЗ `plans/tz/2026-05-25-meeting-report-split-from-block-ingest.md`,
 * Фаза 6. Промпт пока остаётся для A/B-сравнения; удалить после 2 недель
 * параллельной работы и положительной обратной связи от продакт-менеджера.
 */
export function buildChaptersV2Prompt(args: BuildArgs): {
  system: string;
  user: string;
} {
  const blocksJson = args.blocks.map((b) => {
    const firstEv = b.evidence[0];
    return {
      id: b.id,
      name: b.name,
      criticalQuestion: b.criticalQuestion,
      trustedAnswer: b.trustedAnswer,
      signalType: b.signalType,
      tags: b.tags,
      startMs: firstEv?.startMs ?? null,
      endMs: firstEv?.endMs ?? null,
    };
  });
  const header = args.meetingTitle
    ? `Заголовок встречи: ${args.meetingTitle}\n\n`
    : '';
  const user = `${header}Канонические блоки встречи (в порядке хронологии):\n${JSON.stringify(blocksJson, null, 2)}\n\nВерни JSON по схеме { chapters: [...] }.`;
  return { system: SYSTEM_PROMPT, user };
}
