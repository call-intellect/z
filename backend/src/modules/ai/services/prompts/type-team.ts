import { z } from 'zod';

import {
  buildExtractTool,
  fieldNullableString,
  fieldString,
  fieldStringArray,
  type PromptInput,
  type PromptOutput,
  TaskItemSchema,
  turnsToText,
  withRoomChatNote,
  withToolInstructions,
} from './common';

export const TOOL_NAME = 'extract_team';

export const SCHEMA = z
  .object({
    discussed: z.array(z.string()),
    decisions: z.array(
      z
        .object({
          text: z.string(),
          speaker: z.string().nullable(),
          changes_what: z.string().nullable(),
        })
        .strict(),
    ),
    tasks: z.array(TaskItemSchema),
    blockers: z.array(z.string()),
    next_step: z.string().nullable(),
    ideas: z.array(z.string()).optional(),
    data_quality: z.string().nullable().optional(),
  })
  .strict();

export type TeamReport = z.infer<typeof SCHEMA>;

const SYSTEM = `Ты — деловой ассистент. Это командная встреча.
Извлеки структурированный отчёт. Все поля — на русском, без оценочных суждений.
- "discussed": темы, которые обсуждались (список коротких пунктов).
- "decisions": принятые решения — список объектов { text, speaker, changes_what }:
  - text — формулировка решения;
  - speaker — кто принял решение (имя/роль) или null, если не названо;
  - changes_what — что меняет это решение (на что влияет) или null, если не ясно.
- "tasks": задачи с ответственными и сроками. assignee/dueDate — null, если не названы.
- "blockers": блокеры/риски, упомянутые на встрече.
- "next_step": следующий шаг команды или null, если не определён.
Если поле пустое — вернуть пустой массив (для строковых null допустим только если так указано).

Само-проверка и различения:
Различай: «решили» (зафиксированное решение) ≠ «обсудили» (вариант без фиксации) ≠ «предложили» (идея). Задача — только обязательство с ответственным; идея/пожелание задачей не считается. Если ответственный/срок не назван — пиши «не уточнено» (это сигнал, не выдумывай). Не было решений/задач — честно «не зафиксировано», не натягивай структуру.

Дополнительно:
- "ideas": идеи и предложения, которые прозвучали, но НЕ стали задачами и НЕ были зафиксированы как решения (пожелания, «надо бы», варианты на будущее). Пустой массив, если таких не было.
- "data_quality": 1-2 фразы о полноте и надёжности входных данных — обрывы транскрипта, неразборчивые места, неопределённые спикеры, реплики без атрибуции. null, если данные полные и претензий нет.

ПРИМЕРЫ.

Положительный пример (что извлечь):
Транскрипт-фрагмент: «Аня (тимлид): Решено — переходим на двухнедельные спринты с понедельника, это сократит хаос с дедлайнами. Петя: Тогда я подготовлю шаблон доски к пятнице. Аня: И давайте как-нибудь попробуем парное ревью — было бы неплохо.».
Вывод: {"discussed": ["переход на двухнедельные спринты", "формат ревью"], "decisions": [{"text": "перейти на двухнедельные спринты с понедельника", "speaker": "Аня (тимлид)", "changes_what": "цикл планирования и контроль дедлайнов"}], "tasks": [{"title": "подготовить шаблон доски спринта", "assignee": "Петя", "dueDate": "пятница"}], "blockers": [], "next_step": "запустить первый спринт с понедельника", "ideas": ["попробовать парное ревью"], "data_quality": null}.

Что НЕ делать (edge case — обсудили вариант, но не зафиксировали решение; транскрипт оборван):
Транскрипт-фрагмент: «Петя: Может, перенесём релиз на следующую неделю? Аня: Возможно, надо подумать, но давайте ещё обсу[обрыв записи]».
Вывод: {"discussed": ["возможный перенос релиза"], "decisions": [], "tasks": [], "blockers": [], "next_step": null, "ideas": ["перенести релиз на следующую неделю"], "data_quality": "Транскрипт обрывается на середине обсуждения, итоговой договорённости в записи нет."}. Пояснение: вариант обсуждался, но НЕ был зафиксирован → в decisions не попадает (идёт в discussed/ideas); решили ≠ обсудили. Поля честно пустые, оборванность отмечена в data_quality, ничего не выдумано.`;

export function buildPrompt(input: PromptInput): PromptOutput {
  return {
    system: withRoomChatNote(withToolInstructions(SYSTEM, TOOL_NAME), input.roomChat),
    user: `Тип встречи: team\nЗаголовок: ${input.meeting.title}\n\nДиалог:\n${turnsToText(input.dialog, input.roomChat)}`,
  };
}

export const TOOL = buildExtractTool(
  TOOL_NAME,
  'Извлечь структурированный отчёт командной встречи',
  {
    discussed: fieldStringArray,
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: fieldString,
          speaker: fieldNullableString,
          changes_what: fieldNullableString,
        },
        required: ['text', 'speaker', 'changes_what'],
        additionalProperties: false,
      },
    },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: fieldString,
          assignee: fieldNullableString,
          dueDate: fieldNullableString,
        },
        required: ['title', 'assignee', 'dueDate'],
        additionalProperties: false,
      },
    },
    blockers: fieldStringArray,
    next_step: fieldNullableString,
    ideas: fieldStringArray,
    data_quality: fieldNullableString,
  },
  [
    'discussed',
    'decisions',
    'tasks',
    'blockers',
    'next_step',
    'ideas',
    'data_quality',
  ],
);
