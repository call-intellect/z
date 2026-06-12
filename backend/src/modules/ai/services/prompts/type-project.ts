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

export const TOOL_NAME = 'extract_project';

export const SCHEMA = z
  .object({
    agreements: z.array(
      z
        .object({
          text: z.string(),
          speaker: z.string().nullable(),
          supersedes: z.string().nullable(),
        })
        .strict(),
    ),
    responsibilities: z.array(
      z
        .object({
          who: z.string(),
          what: z.string(),
          deadline: z.string().nullable(),
        })
        .strict(),
    ),
    deadlines: z.array(z.string()),
    risks: z.array(z.string()),
    open_questions: z.array(z.string()),
    next_step: z.string().nullable(),
    ideas: z.array(z.string()).optional(),
    data_quality: z.string().nullable().optional(),
  })
  .strict();

const SYSTEM = `Ты — деловой ассистент. Это проектная встреча.

ЯЗЫК ВЫВОДА:
- Все строковые значения в ответе — на русском.
- Если транскрипт на другом языке — переводи смысл.
- Имена собственные (компании, продукты, люди) — оставляй как есть.

Извлеки:
- "agreements": договорённости сторон — список объектов { text, speaker, supersedes }:
  - text — формулировка договорённости;
  - speaker — кто её озвучил/принял (имя/роль) или null, если не названо;
  - supersedes — какую прежнюю договорённость она отменяет/заменяет или null, если ничего не заменяет.
- "responsibilities": зоны ответственности — список объектов { who, what, deadline }:
  - who — кто отвечает (имя/роль);
  - what — за что отвечает;
  - deadline — срок по этой зоне ответственности или null, если не назван.
- "deadlines": сроки/дедлайны (текстом, со ссылкой на задачу/блок если упомянуто).
- "risks": риски проекта.
- "open_questions": открытые вопросы.
- "next_step": ближайший следующий шаг или null.

Само-проверка и различения:
agreements — только принятые решения, не обсуждённые варианты. Идея/предложение ≠ договорённость ≠ задача. Если ответственный/срок не назван — «не уточнено». Пусто — честно «не зафиксировано».

Дополнительно:
- "ideas": идеи и предложения по проекту, которые прозвучали, но НЕ стали договорённостями и НЕ зафиксированы как зоны ответственности (варианты «можно было бы», «давайте подумаем», предложения на будущее). Пустой массив, если таких не было.
- "data_quality": 1-2 фразы о полноте и надёжности входных данных — обрывы транскрипта, неразборчивые места, неопределённые спикеры, реплики без атрибуции. null, если данные полные и претензий нет.

ПРИМЕРЫ.

Положительный пример (что извлечь):
Транскрипт-фрагмент: «Пётр (тимлид): Давайте API оплаты делает Аня к пятнице. Аня: Беру, к пятнице сделаю. Пётр: И ещё мысль — можно потом вынести очередь в отдельный сервис. Аня: Да, как идея на будущее.».
Вывод: {"agreements": [{"text": "API оплаты делает Аня, срок — пятница", "speaker": "Пётр", "supersedes": null}], "responsibilities": [{"who": "Аня", "what": "API оплаты", "deadline": "пятница"}], "deadlines": ["API оплаты — к пятнице"], "risks": [], "open_questions": [], "next_step": "Аня делает API оплаты к пятнице", "ideas": ["вынести очередь в отдельный сервис"], "data_quality": null}.

Что НЕ делать (edge case — обсуждение без договорённости + обрезанный транскрипт):
Транскрипт-фрагмент: «…спикер 1: а если перенести релиз на неделю? спикер 2: ну можно подумать, давайте обсудим завтра…».
Вывод: {"agreements": [], "responsibilities": [], "deadlines": [], "risks": [], "open_questions": ["переносить ли релиз на неделю"], "next_step": null, "ideas": ["перенести релиз на неделю"], "data_quality": "Транскрипт обрезан с обеих сторон, спикеры не атрибутированы, договорённости не зафиксированы."}. Пояснение: «можно подумать, обсудим завтра» — это обсуждение, а не решение → НЕ в agreements/responsibilities; предложение перенести релиз — это идея → в ideas; при бедном транскрипте поля пустые, а не выдуманные, и заполнен data_quality.`;

export function buildPrompt(input: PromptInput): PromptOutput {
  return {
    system: withRoomChatNote(withToolInstructions(SYSTEM, TOOL_NAME), input.roomChat),
    user: `Тип встречи: project\nЗаголовок: ${input.meeting.title}\n\nДиалог:\n${turnsToText(input.dialog, input.roomChat)}`,
  };
}

export const TOOL = buildExtractTool(
  TOOL_NAME,
  'Извлечь отчёт проектной встречи',
  {
    agreements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: fieldString,
          speaker: fieldNullableString,
          supersedes: fieldNullableString,
        },
        required: ['text', 'speaker', 'supersedes'],
        additionalProperties: false,
      },
    },
    responsibilities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          who: fieldString,
          what: fieldString,
          deadline: fieldNullableString,
        },
        required: ['who', 'what', 'deadline'],
        additionalProperties: false,
      },
    },
    deadlines: fieldStringArray,
    risks: fieldStringArray,
    open_questions: fieldStringArray,
    next_step: fieldNullableString,
    ideas: fieldStringArray,
    data_quality: fieldNullableString,
  },
  [
    'agreements',
    'responsibilities',
    'deadlines',
    'risks',
    'open_questions',
    'next_step',
    'ideas',
    'data_quality',
  ],
);
