import { z } from 'zod';

import { type DialogTurn, turnsToText } from './common';

/**
 * Промпт для извлечения глав встречи.
 *
 * LlmRouter с `taskType='chapters'` + `responseFormat='json'` —
 * модель должна вернуть JSON-массив `MeetingChapterDraft[]` (без обёрток).
 * Парсинг и валидация — на стороне `ChapterExtractionService`.
 *
 * Хранится в МС (миллисекундах от начала записи), потому что в БД
 * (`MeetingChapter.startMs/endMs`) — миллисекунды.
 */
export const CHAPTERS_TASK_TYPE = 'chapters';
export const CHAPTERS_PROMPT_NAME = 'chapters_v1';

export const ChapterDraftSchema = z
  .object({
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
    title: z.string().min(1).max(200),
    summary: z.string().max(2000).nullable().optional(),
    order: z.number().int().nonnegative(),
  })
  .strict();
export type ChapterDraft = z.infer<typeof ChapterDraftSchema>;

export const ChaptersArraySchema = z.array(ChapterDraftSchema).min(1).max(20);

const CHAPTERS_SYSTEM = `Ты — деловой ассистент. Разбей встречу на смысловые главы (chapters).

Правила:
- Минимум 3, максимум 12 глав.
- Каждая глава — связный смысловой блок (тема обсуждения, переход к новому вопросу, демо, обсуждение следующих шагов и т.п.).
- "title" — короткий (3–8 слов), на русском.
- "summary" — 1–2 предложения, что обсудили в этой главе. Можно null если глава очень короткая.
- "startMs", "endMs" — границы главы в миллисекундах от начала встречи.
- "order" — порядковый номер главы, начиная с 0; идёт по возрастанию.

Формат ответа: ТОЛЬКО валидный JSON-массив без какого-либо текста до или после.
Пример: [{"startMs":0,"endMs":120000,"title":"Введение","summary":"Знакомство и повестка.","order":0}, ...]`;

export interface ChaptersPromptInput {
  meeting: { id: string; type: string; title: string };
  dialog: DialogTurn[];
}

export function buildChaptersPrompt(input: ChaptersPromptInput): {
  system: string;
  user: string;
} {
  const dialog = turnsToText(input.dialog);
  return {
    system: CHAPTERS_SYSTEM,
    user: `Тип встречи: ${input.meeting.type}
Заголовок: ${input.meeting.title}

Диалог (timestamps в формате [mm:ss-mm:ss]):
${dialog}

Верни JSON-массив глав. Reply with valid JSON only.`,
  };
}
