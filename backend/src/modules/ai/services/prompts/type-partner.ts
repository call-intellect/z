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

export const TOOL_NAME = 'extract_partner';

export const SCHEMA = z
  .object({
    benefit_for_us: z.array(z.string()),
    benefit_for_partner: z.array(z.string()),
    partnership_model: z.string().nullable(),
    joint_mechanics: z.array(z.string()),
    pilot: z.string().nullable(),
    risks: z.array(z.string()),
    next_step: z.string().nullable(),
    // A11-Волна2 (additive, опциональное — обратная совместимость):
    data_quality: z.string().nullable().optional(),
  })
  .strict();

const SYSTEM = `Ты — деловой ассистент. Это партнёрская встреча.

ЯЗЫК ВЫВОДА:
- Все строковые значения в ответе — на русском.
- Если транскрипт на другом языке — переводи смысл.
- Имена собственные (компании, продукты, люди) — оставляй как есть.

Извлеки:
- "benefit_for_us": выгода для нашей стороны (массив).
- "benefit_for_partner": выгода для партнёра.
- "partnership_model": модель партнёрства (например "комиссия с продаж", "co-marketing"), или null.
- "joint_mechanics": совместные механики/активности.
- "pilot": формат пилотного проекта (или null).
- "risks": риски сотрудничества.
- "next_step": ближайший следующий шаг или null.

Стороны: наша сторона vs партнёр. benefit_for_us НЕ домысливай — только если прозвучало явно. risks/next_step — конкретны или null. joint_mechanics/risks атрибутируй источнику («партнёр предложил» vs «мы»). Пусто — «не зафиксировано».

Дополнительно извлеки:
- "data_quality": 1–2 фразы о полноте данных встречи — насколько полный транскрипт, есть ли неопределённые спикеры, ненадёжные для распознавания места (числа/имена/термины); null, если оговорок нет.

ПРИМЕРЫ.

Положительный пример (что извлечь):
Транскрипт-фрагмент: «Партнёр: Давайте так — вы приводите клиентов, мы платим 15% с каждой оплаченной подписки. Маша (наша сторона): Согласны. Стартуем с пилота на 2 месяца по одному сегменту, к 1 июля сверим конверсию. Партнёр: Договорились, со-маркетинг тоже сделаем — общий вебинар.».
Вывод: {"benefit_for_us": ["приток клиентов через канал партнёра"], "benefit_for_partner": ["15% комиссии с оплаченных подписок"], "partnership_model": "комиссия 15% с продаж", "joint_mechanics": ["со-маркетинг: общий вебинар (предложил партнёр)"], "pilot": "2 месяца по одному сегменту, сверка конверсии к 1 июля", "risks": [], "next_step": "запустить пилот на 2 месяца по одному сегменту", "data_quality": null}.

Что НЕ делать (edge case — устный интерес ≠ договорённость, обрезанный транскрипт):
Транскрипт-фрагмент: «Партнёр: Звучит любопытно, мы у себя подумаем о партнёрстве, вернёмся… [запись обрывается]».
Вывод: {"benefit_for_us": [], "benefit_for_partner": [], "partnership_model": null, "joint_mechanics": [], "pilot": null, "risks": [], "next_step": null, "data_quality": "Транскрипт обрезан на середине, прозвучала только реплика партнёра; договорённости не зафиксированы."}. Пояснение: «подумаем о партнёрстве» — это не модель партнёрства и не next_step (договорённости НЕ было). Внутреннюю оценку перспективности наружу в отчёт не выносим; при бедном/обрезанном транскрипте поля пустые, причина — в data_quality, без домысла.`;

export function buildPrompt(input: PromptInput): PromptOutput {
  return {
    system: withRoomChatNote(withToolInstructions(SYSTEM, TOOL_NAME), input.roomChat),
    user: `Тип встречи: partner\nЗаголовок: ${input.meeting.title}\n\nДиалог:\n${turnsToText(input.dialog, input.roomChat)}`,
  };
}

export const TOOL = buildExtractTool(
  TOOL_NAME,
  'Извлечь отчёт партнёрской встречи',
  {
    benefit_for_us: fieldStringArray,
    benefit_for_partner: fieldStringArray,
    partnership_model: fieldNullableString,
    joint_mechanics: fieldStringArray,
    pilot: fieldNullableString,
    risks: fieldStringArray,
    next_step: fieldNullableString,
    data_quality: fieldNullableString,
  },
  [
    'benefit_for_us',
    'benefit_for_partner',
    'partnership_model',
    'joint_mechanics',
    'pilot',
    'risks',
    'next_step',
    'data_quality',
  ],
);
