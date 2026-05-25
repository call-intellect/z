import { z } from 'zod';

import { type DialogTurn, turnsToText } from './common';

/**
 * Промпт для извлечения глав встречи.
 *
 * LlmRouter с `taskType='chapters'` + `responseFormat='json_schema'` —
 * модель должна вернуть `{ chapters: ChapterDraft[] }` (root — object, как
 * требует DeepSeek/OpenAI strict JSON Schema и эмулированный Anthropic
 * tool_use). Парсинг и валидация — на стороне `ChapterExtractionService`.
 *
 * Хранится в МС (миллисекундах от начала записи), потому что в БД
 * (`MeetingChapter.startMs/endMs`) — миллисекунды.
 *
 * Fallback при отсутствии strict-поддержки у провайдера (Ollama, KIE, GRSAI)
 * — текст «Reply with valid JSON only» в user остаётся в качестве запасной
 * инструкции (см. T7-F6 §9.3).
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

/**
 * Wrapper-схема: root JSON Schema strict требует object на верхнем уровне.
 * Обёртка `{ chapters: [...] }` нужна для DeepSeek/OpenAI/Anthropic.
 * Голый массив (как было раньше) использовался только потому, что
 * `json_object` не валидировал структуру.
 */
export const ChaptersResponseSchema = z
  .object({ chapters: ChaptersArraySchema })
  .strict();
export type ChaptersResponse = z.infer<typeof ChaptersResponseSchema>;

/** JSON Schema для `responseFormat: { type: 'json_schema', strict: true }`. */
export const CHAPTERS_JSON_SCHEMA = z.toJSONSchema(ChaptersResponseSchema, {
  target: 'draft-7',
}) as Record<string, unknown>;

const CHAPTERS_SYSTEM = `Ты — деловой ассистент. Разбей встречу на смысловые главы (chapters).

Правила:
- Минимум 3, максимум 12 глав.
- Каждая глава — связный смысловой блок (тема обсуждения, переход к новому вопросу, демо, обсуждение следующих шагов и т.п.).
- "title" — короткий (3–8 слов), на русском.
- "summary" — 1–2 предложения, что обсудили в этой главе. Можно null если глава очень короткая.
- "startMs", "endMs" — границы главы в миллисекундах от начала встречи.
- "order" — порядковый номер главы, начиная с 0; идёт по возрастанию.

Формат ответа — объект JSON с одним полем "chapters" (массив глав).
Пример: {"chapters":[{"startMs":0,"endMs":120000,"title":"Введение","summary":"Знакомство и повестка.","order":0}]}`;

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

Верни JSON-объект {"chapters":[...]} (см. описание формата выше). Если provider не поддерживает strict JSON Schema — всё равно отвечай ТОЛЬКО валидным JSON без markdown.`,
  };
}
