import { z } from 'zod';

import {
  buildExtractTool,
  fieldNullableString,
  fieldString,
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
    not_done: z.array(
      z
        .object({
          item: z.string(),
          responsible: z.string().nullable(),
          reason: z.string().nullable(),
        })
        .strict(),
    ),
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
- "not_done": что не сделано — список объектов { item, responsible, reason }:
  - item — что именно не сделано;
  - responsible — кто отвечал за этот пункт (имя/роль) или null, если не названо;
  - reason — причина невыполнения или null, если причина не названа.
- "deviation_reasons": причины отклонений от плана.
- "responsible": ответственные (имена/роли).
- "risks": риски на следующий период.
- "next_plan": план на следующий период.
- "next_step": ближайший шаг или null.

Само-проверка и различения:
responsible привязывай к конкретным пунктам, не общё. done и not_done взаимоисключающи (пункт либо там, либо там). Если причина невыполнения не названа — не выдумывай. Пусто — «не выявлено».

Дополнительно:
- "unexplained_gaps": невыполненные пункты, по которым причина отклонения НЕ была названа на встрече (расхождение план/факт без объяснения). Это подмножество not_done без соответствующей записи в deviation_reasons. Пустой массив, если все отклонения объяснены или невыполненных пунктов нет.
- "data_quality": 1-2 фразы о полноте и надёжности входных данных — обрывы транскрипта, неразборчивые места, неопределённые спикеры, реплики без атрибуции. null, если данные полные и претензий нет.

ПРИМЕРЫ.

Положительный пример (что извлечь):
Транскрипт-фрагмент: «Из 5 задач спринта сделали 3. Интеграцию с 1С не успели — Олег был на больничном. Отчёт по продажам не трогали, причину не назвали».
Вывод: {"planned": [], "done": ["Закрыты 3 из 5 задач спринта"], "not_done": [{"item": "Интеграция с 1С", "responsible": "Олег", "reason": "был на больничном"}, {"item": "Отчёт по продажам", "responsible": null, "reason": null}], "deviation_reasons": ["Олег был на больничном — не успели интеграцию с 1С"], "responsible": ["Олег"], "risks": [], "next_plan": [], "next_step": null, "unexplained_gaps": ["Отчёт по продажам — причина не названа"], "data_quality": "Транскрипт полный, спикеры распознаны."}.

Что НЕ делать (edge case — бедный/обрезанный транскрипт + смешение «обсудили» и «сделали»):
Транскрипт-фрагмент: «…[обрыв]… давайте подумаем, можно ли ускорить отгрузку. Хорошая идея, обсудим в следующий раз про новый склад».
Вывод: {"planned": [], "done": [], "not_done": [], "deviation_reasons": [], "responsible": [], "risks": [], "next_plan": [], "next_step": null, "unexplained_gaps": [], "data_quality": "Транскрипт обрезан в начале, покрытие спикерами неполное, низкая уверенность."}. Пояснение: «обсудили / давайте подумаем» — это разговор, а не выполненная работа → не в done. «Новый склад» — предложение/идея на будущее, а не запланированная или сделанная задача → не в planned и не в done. «Не успели» с причиной → not_done с reason; «не успели / не сделали» БЕЗ причины → not_done с reason=null и пункт в unexplained_gaps (причину НЕ выдумывать). При бедном входе поля пустые, заполнен только data_quality.`;

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
    not_done: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          item: fieldString,
          responsible: fieldNullableString,
          reason: fieldNullableString,
        },
        required: ['item', 'responsible', 'reason'],
        additionalProperties: false,
      },
    },
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
