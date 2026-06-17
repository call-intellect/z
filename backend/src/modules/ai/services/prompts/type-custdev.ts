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

export const TOOL_NAME = 'extract_custdev';

export const SCHEMA = z
  .object({
    pains: z.array(z.string()),
    use_cases: z.array(z.string()),
    quotes: z.array(z.string()),
    alternatives: z.array(z.string()),
    frequency: z.string().nullable(),
    willingness_to_pay: z.string().nullable(),
    insights: z.array(z.string()),
    data_quality: z.string().nullable().optional(),
  })
  .strict();

const SYSTEM = `Ты — продуктовый ассистент. Это CustDev / интервью.

ЯЗЫК ВЫВОДА:
- Все строковые значения в ответе — на русском.
- Если транскрипт на другом языке — переводи смысл.
- Имена собственные (компании, продукты, люди) — оставляй как есть.

Извлеки:
- "pains": боли респондента (массив).
- "use_cases": сценарии использования / контекст работы.
- "quotes": цитаты респондента дословно (важные формулировки).
- "alternatives": какие альтернативы / workaround'ы он использует сегодня.
- "frequency": как часто проблема случается (или null).
- "willingness_to_pay": готовность платить (или null).
- "insights": ключевые инсайты для команды продукта.

Стороны: интервьюер (наша) vs респондент. quotes/pains/use_cases — ТОЛЬКО слова РЕСПОНДЕНТА, не интервьюера. insights — это интерпретация; quotes — дословный факт; не путай. Пусто — честно «не выявлено».

Дополнительно извлеки:
- "data_quality": 1–2 фразы о полноте данных встречи — насколько полный транскрипт, есть ли неопределённые спикеры, ненадёжные для распознавания места (числа/имена/термины); null, если оговорок нет.

ПРИМЕРЫ.

Положительный пример (что извлечь):
Транскрипт-фрагмент: «Респондент: Каждый понедельник руками сводим отчёт по продажам в Excel — часа три уходит, бесит. Сейчас просто копируем выгрузку из CRM и правим формулы. Если бы это собиралось само, мы бы и 30 тысяч в месяц отдали».
Вывод: {"pains": ["ручная сводка отчёта по продажам в Excel занимает ~3 часа каждый понедельник"], "use_cases": ["еженедельная сводка отчёта по продажам"], "quotes": ["каждый понедельник руками сводим отчёт по продажам в Excel — часа три уходит, бесит"], "alternatives": ["копируют выгрузку из CRM и правят формулы вручную"], "frequency": "каждую неделю (по понедельникам)", "willingness_to_pay": "до 30 тысяч в месяц", "insights": ["автоматизация еженедельной сводки — явная боль с готовностью платить"], "data_quality": null}. Пояснение: боль реально прозвучала от респондента; цифры частоты и оплаты названы дословно.

Что НЕ делать (edge case — гипотеза клиента ≠ установленная потребность):
Транскрипт-фрагмент: «Интервьюер: А такая штука была бы вам полезна? Респондент: Ну… наверное да, нам бы, может, помогло. Хотя сейчас особо не страдаем от этого».
Вывод: {"pains": [], "use_cases": [], "quotes": [], "alternatives": [], "frequency": null, "willingness_to_pay": null, "insights": ["клиент допускает гипотетическую пользу, но боли не подтвердил («сейчас особо не страдаем») — нужна проверка"], "data_quality": "Респондент отвечал гипотетически, реальной боли не подтвердил; интерес не верифицирован."}. Пояснение: «наверное помогло бы» — это гипотеза, не факт; нельзя записывать в pains как установленную потребность. Оценки интервьюера НЕ попадают в нейтральные поля респондента (quotes/pains/use_cases).`;

export function buildPrompt(input: PromptInput): PromptOutput {
  return {
    system: withRoomChatNote(withToolInstructions(SYSTEM, TOOL_NAME), input.roomChat),
    user: `Тип встречи: custdev\nЗаголовок: ${input.meeting.title}\n\nДиалог:\n${turnsToText(input.dialog, input.roomChat)}`,
  };
}

export const TOOL = buildExtractTool(
  TOOL_NAME,
  'Извлечь отчёт CustDev-интервью',
  {
    pains: fieldStringArray,
    use_cases: fieldStringArray,
    quotes: fieldStringArray,
    alternatives: fieldStringArray,
    frequency: fieldNullableString,
    willingness_to_pay: fieldNullableString,
    insights: fieldStringArray,
    data_quality: fieldNullableString,
  },
  [
    'pains',
    'use_cases',
    'quotes',
    'alternatives',
    'frequency',
    'willingness_to_pay',
    'insights',
    'data_quality',
  ],
);
