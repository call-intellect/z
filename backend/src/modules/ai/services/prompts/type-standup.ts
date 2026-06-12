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

export const TOOL_NAME = 'extract_standup';

export const SCHEMA = z
  .object({
    priorities: z.array(z.string()),
    who_does_what: z.array(
      z.object({ person: z.string(), doing: z.string() }).strict(),
    ),
    new_tasks: z.array(z.string()),
    blockers: z.array(z.string()),
    decisions_needed: z.array(z.string()),
    next_checkpoint: z.string().nullable(),
    proposals: z.array(z.string()).optional(),
    data_quality: z.string().nullable().optional(),
  })
  .strict();

const SYSTEM = `Ты — деловой ассистент. Это планёрка / standup.

ЯЗЫК ВЫВОДА:
- Все строковые значения в ответе — на русском.
- Если транскрипт на другом языке — переводи смысл.
- Имена собственные (компании, продукты, люди) — оставляй как есть.

- "priorities": текущие приоритеты команды.
- "who_does_what": кто чем занимается (массив пар person + doing).
- "new_tasks": задачи, появившиеся на встрече.
- "blockers": блокеры участников.
- "decisions_needed": вопросы, требующие решения руководителя.
- "next_checkpoint": следующая контрольная точка / null.
Не выдумывай.

Само-проверка и различения:
new_tasks — только реальные обязательства, не пожелания. who_does_what: если исполнитель не установлен по репликам — person=«не определён», не угадывай из контекста. Пусто — честно «не зафиксировано».

Дополнительно:
- "proposals": идеи и пожелания, прозвучавшие на планёрке, но НЕ ставшие задачами (предложения «надо бы», «давайте попробуем», варианты без обязательства). Пустой массив, если таких не было.
- "data_quality": 1-2 фразы о полноте и надёжности входных данных — обрывы транскрипта, неразборчивые места, неопределённые спикеры, реплики без атрибуции. null, если данные полные и претензий нет.

ПРИМЕРЫ.

Положительный пример (что извлечь):
Транскрипт-фрагмент: «Аня: вчера закрыла авторизацию, сегодня беру оплату — релиз к пятнице. Петя: я застрял на интеграции с 1С, жду доступы от админов. Аня: давайте ещё попробуем вынести логи в отдельный сервис, было бы удобнее. Руководитель: ок, по доступам решу сегодня».
Вывод: {"priorities": ["релиз модуля оплаты к пятнице"], "who_does_what": [{"person": "Аня", "doing": "делает модуль оплаты"}, {"person": "Петя", "doing": "интеграция с 1С"}], "new_tasks": ["Аня: довести модуль оплаты к пятнице"], "blockers": ["Петя ждёт доступы от админов по 1С"], "decisions_needed": ["выдать Пете доступы для 1С"], "next_checkpoint": "пятница — релиз оплаты", "proposals": ["вынести логи в отдельный сервис"], "data_quality": null}.

Что НЕ делать (edge case — идея ≠ задача, срок не уточнён):
Транскрипт-фрагмент: «Сергей: надо бы как-нибудь обновить дизайн лендинга, давно пора. Руководитель: да, мысль хорошая».
Вывод: {"priorities": [], "who_does_what": [], "new_tasks": [], "blockers": [], "decisions_needed": [], "next_checkpoint": null, "proposals": ["обновить дизайн лендинга"], "data_quality": null}. Пояснение: «надо бы как-нибудь» — пожелание без исполнителя и срока → в proposals, НЕ в new_tasks; срок/ответственного не выдумываем.

Что НЕ делать (edge case — бедный/обрезанный транскрипт):
Транскрипт-фрагмент: «…[обрыв записи]… по задачам всё, расходимся».
Вывод: {"priorities": [], "who_does_what": [], "new_tasks": [], "blockers": [], "decisions_needed": [], "next_checkpoint": null, "proposals": [], "data_quality": "транскрипт обрезан (обрыв записи), содержательная часть планёрки не покрыта — поля пусты, выводы делать не на чем"}. Пояснение: при обрезанном/пустом входе поля честно пустые, наполняем только data_quality, без догадок.`;

export function buildPrompt(input: PromptInput): PromptOutput {
  return {
    system: withRoomChatNote(withToolInstructions(SYSTEM, TOOL_NAME), input.roomChat),
    user: `Тип встречи: standup\nЗаголовок: ${input.meeting.title}\n\nДиалог:\n${turnsToText(input.dialog, input.roomChat)}`,
  };
}

export const TOOL = buildExtractTool(
  TOOL_NAME,
  'Извлечь структурированный отчёт планёрки',
  {
    priorities: fieldStringArray,
    who_does_what: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          person: fieldString,
          doing: fieldString,
        },
        required: ['person', 'doing'],
        additionalProperties: false,
      },
    },
    new_tasks: fieldStringArray,
    blockers: fieldStringArray,
    decisions_needed: fieldStringArray,
    next_checkpoint: fieldNullableString,
    proposals: fieldStringArray,
    data_quality: fieldNullableString,
  },
  [
    'priorities',
    'who_does_what',
    'new_tasks',
    'blockers',
    'decisions_needed',
    'next_checkpoint',
    'proposals',
    'data_quality',
  ],
);
