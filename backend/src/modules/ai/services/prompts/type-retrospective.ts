import { z } from 'zod';

import {
  buildExtractTool,
  fieldEnum,
  fieldNullableString,
  fieldStringArray,
  type PromptInput,
  type PromptOutput,
  TaskItemSchema,
  turnsToText,
  withRoomChatNote,
  withToolInstructions,
} from './common';

/**
 * Промпт для типа встречи `retrospective` — командная ретроспектива
 * (по итогам спринта/проекта/инцидента). См. enum MeetingType в schema.prisma.
 *
 * CRIT-2 (2026-05-24): до этого `retrospective` fallback'ился на
 * `team.buildPrompt` в `prompts/index.ts`. Это плохой fallback: ретро —
 * это формат «что работало / что не работало / action items», а не оперативка.
 *
 * См. plans/analysis/2026-05-22-code-reality-deltas.md §CRIT-2.
 */
export const TOOL_NAME = 'extract_retrospective';

const MOOD_VALUES = ['positive', 'mixed', 'negative', 'unknown'] as const;

export const SCHEMA = z
  .object({
    /** Что работало хорошо — практики, процессы, решения, которые стоит сохранить. */
    what_worked: z.array(z.string()),
    /** Что не работало — болевые точки, неэффективные процессы, повторяющиеся проблемы. */
    what_did_not_work: z.array(z.string()),
    /** Action items с ответственными и сроками (как в team-промпте). */
    action_items: z.array(TaskItemSchema),
    /** Эксперименты, которые команда решила попробовать в следующем цикле. */
    experiments: z.array(z.string()),
    /** Благодарности / признание заслуг участников команды. */
    kudos: z.array(z.string()),
    /** Общее настроение команды по итогам обсуждения. */
    team_mood: z.enum(MOOD_VALUES),
    /** Краткое summary настроения (1-2 предложения) или null. */
    mood_notes: z.string().nullable(),
  })
  .strict();

export type RetrospectiveReport = z.infer<typeof SCHEMA>;

const SYSTEM = `Ты — деловой ассистент. Это ретроспектива команды (retrospective) — обсуждение по итогам спринта, проекта или инцидента в формате «что работало / что не работало / action items».
Извлеки структурированный отчёт. Все поля — на русском, без оценочных суждений и без выдумывания.
- "what_worked": что работало хорошо — практики, процессы и решения, которые стоит сохранить.
- "what_did_not_work": что не работало — болевые точки, неэффективные процессы, повторяющиеся проблемы.
- "action_items": конкретные действия для исправления. Каждое — title + assignee + dueDate. assignee/dueDate = null, если не названы явно.
- "experiments": эксперименты, которые команда решила попробовать в следующем цикле.
- "kudos": благодарности участникам, признание заслуг.
- "team_mood": одно из значений ${MOOD_VALUES.join(' | ')}. "unknown" — если по диалогу нельзя надёжно определить.
- "mood_notes": 1-2 предложения о настроении команды (откуда вывод) или null.
Если массив пустой — возвращай []. Не дублируй пункты между what_worked и what_did_not_work.`;

export function buildPrompt(input: PromptInput): PromptOutput {
  return {
    system: withRoomChatNote(withToolInstructions(SYSTEM, TOOL_NAME), input.roomChat),
    user: `Тип встречи: retrospective\nЗаголовок: ${input.meeting.title}\n\nДиалог:\n${turnsToText(input.dialog, input.roomChat)}`,
  };
}

export const TOOL = buildExtractTool(
  TOOL_NAME,
  'Извлечь структурированный отчёт ретроспективы команды',
  {
    what_worked: fieldStringArray,
    what_did_not_work: fieldStringArray,
    action_items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          assignee: { type: ['string', 'null'] },
          dueDate: { type: ['string', 'null'] },
        },
        required: ['title', 'assignee', 'dueDate'],
        additionalProperties: false,
      },
    },
    experiments: fieldStringArray,
    kudos: fieldStringArray,
    team_mood: fieldEnum(MOOD_VALUES),
    mood_notes: fieldNullableString,
  },
  [
    'what_worked',
    'what_did_not_work',
    'action_items',
    'experiments',
    'kudos',
    'team_mood',
    'mood_notes',
  ],
);
