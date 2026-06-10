import { z } from 'zod';

import {
  buildExtractTool,
  fieldNullableString,
  fieldStringArray,
  type PromptInput,
  type PromptOutput,
  turnsToText,
  withRoomChatNote,
  withToolInstructions,
} from './common';

export const TOOL_NAME = 'extract_plan_fact';

export const SCHEMA = z
  .object({
    planned: z.array(z.string()),
    done: z.array(z.string()),
    not_done: z.array(z.string()),
    deviation_reasons: z.array(z.string()),
    responsible: z.array(z.string()),
    risks: z.array(z.string()),
    next_plan: z.array(z.string()),
    next_step: z.string().nullable(),
    unexplained_gaps: z.array(z.string()).optional(),
    data_quality: z.string().nullable().optional(),
  })
  .strict();

const SYSTEM = `Ты — деловой ассистент. Это встреча "план/факт по задачам".

ЯЗЫК ВЫВОДА:
- Все строковые значения в ответе — на русском.
- Если транскрипт на другом языке — переводи смысл.
- Имена собственные (компании, продукты, люди) — оставляй как есть.

Извлеки:
- "planned": что было запланировано.
- "done": что фактически сделано.
- "not_done": что не сделано.
- "deviation_reasons": причины отклонений от плана.
- "responsible": ответственные (имена/роли).
- "risks": риски на следующий период.
- "next_plan": план на следующий период.
- "next_step": ближайший шаг или null.

Само-проверка и различения:
responsible привязывай к конкретным пунктам, не общё. done и not_done взаимоисключающи (пункт либо там, либо там). Если причина невыполнения не названа — не выдумывай. Пусто — «не выявлено».

Дополнительно:
- "unexplained_gaps": невыполненные пункты, по которым причина отклонения НЕ была названа на встрече (расхождение план/факт без объяснения). Это подмножество not_done без соответствующей записи в deviation_reasons. Пустой массив, если все отклонения объяснены или невыполненных пунктов нет.
- "data_quality": 1-2 фразы о полноте и надёжности входных данных — обрывы транскрипта, неразборчивые места, неопределённые спикеры, реплики без атрибуции. null, если данные полные и претензий нет.`;

export function buildPrompt(input: PromptInput): PromptOutput {
  return {
    system: withRoomChatNote(withToolInstructions(SYSTEM, TOOL_NAME), input.roomChat),
    user: `Тип встречи: plan_fact\nЗаголовок: ${input.meeting.title}\n\nДиалог:\n${turnsToText(input.dialog, input.roomChat)}`,
  };
}

export const TOOL = buildExtractTool(
  TOOL_NAME,
  'Извлечь отчёт план/факт',
  {
    planned: fieldStringArray,
    done: fieldStringArray,
    not_done: fieldStringArray,
    deviation_reasons: fieldStringArray,
    responsible: fieldStringArray,
    risks: fieldStringArray,
    next_plan: fieldStringArray,
    next_step: fieldNullableString,
    unexplained_gaps: fieldStringArray,
    data_quality: fieldNullableString,
  },
  [
    'planned',
    'done',
    'not_done',
    'deviation_reasons',
    'responsible',
    'risks',
    'next_plan',
    'next_step',
    'unexplained_gaps',
    'data_quality',
  ],
);
