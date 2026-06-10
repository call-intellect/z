import { z } from 'zod';

import {
  buildExtractTool,
  fieldEnum,
  fieldNullableEnum,
  fieldNullableString,
  fieldString,
  fieldStringArray,
  type PromptInput,
  type PromptOutput,
  turnsToText,
  withRoomChatNote,
  withToolInstructions,
} from './common';

export const TOOL_NAME = 'extract_sales';

export const SCHEMA = z
  .object({
    pain: z.string().nullable(),
    interest_level: z.enum(['low', 'medium', 'high']).nullable(),
    objections: z.array(z.string()),
    budget: z.string().nullable(),
    decision_maker: z.string().nullable(),
    urgency: z.string().nullable(),
    next_step: z.string(),
    // A11-Волна2 (additive, опциональные — обратная совместимость):
    competitors: z.array(z.string()).optional(),
    decision_criteria: z.array(z.string()).optional(),
    what_hooked: z.string().nullable().optional(),
    main_blocker: z.string().nullable().optional(),
    data_quality: z.string().nullable().optional(),
  })
  .strict();

const SYSTEM = `Ты — sales-ассистент. Это продажная встреча.

ЯЗЫК ВЫВОДА:
- Все строковые значения в ответе — на русском.
- Если транскрипт на другом языке — переводи смысл.
- Имена собственные (компании, продукты, люди) — оставляй как есть.

Извлеки:
- "pain": боль клиента или null.
- "interest_level": уровень интереса (low/medium/high) или null.
  Якоря шкалы (ТЗ F2):
  - high — клиент задал ≥2 уточняющих вопроса о покупке/сроках/условиях,
           либо явно обозначил готовность («давайте подписывать»);
  - medium — обсудил кейсы, попросил материалы, но не уточнял коммерцию;
  - low — слушал, не задавал вопросов или возражал на каждом шаге.
- "objections": возражения клиента (массив).
- "budget": упомянутый бюджет или null.
- "decision_maker": кто ЛПР, или null.
- "urgency": срочность принятия решения или null.
- "next_step": конкретный следующий шаг (обязательно строка). Если не было — напиши "уточнить следующий шаг с клиентом".
Не выдумывай данных, которых нет в диалоге.

ПРИМЕРЫ.

Положительный пример (что извлечь):
Транскрипт-фрагмент: «Иван (клиент): По цене ок, но у нас бюджет до 400 тысяч в квартал. Маша (менеджер): Понятно, обсудите с финансовым директором? Иван: Да, к четвергу принесу ответ. И ещё — а интеграция с 1С идёт в стандартной поставке?».
Вывод: {"pain": null, "interest_level": "high", "objections": ["бюджет ограничен 400к/квартал"], "budget": "до 400 тысяч в квартал", "decision_maker": "финансовый директор", "urgency": "ответ к четвергу", "next_step": "дождаться ответа клиента к четвергу после согласования с финдиром"}.

Что НЕ делать (edge case — общие вопросы без коммерческих сигналов):
Транскрипт-фрагмент: «Иван (клиент): Расскажите, что у вас за продукт. Маша: Мы делаем платформу памяти компании на встречах. Иван: Интересно. А кто ещё этим пользуется?».
Вывод: {"pain": null, "interest_level": "low", "objections": [], "budget": null, "decision_maker": null, "urgency": null, "next_step": "уточнить следующий шаг с клиентом"}. Пояснение: НЕТ уточняющих вопросов о покупке/сроках/цене → не medium, а low.

Стороны: НАША сторона презентует продукт и спрашивает о бизнесе собеседника; сторона КЛИЕНТА рассказывает о процессах и спрашивает о продукте. Реплику без атрибуции — «сторона не определена», не угадывай. Само-проверка: оценки/температура/конкуренты — только если реально прозвучали; не приписывай слова не тому спикеру.

Дополнительно извлеки:
- "competitors": конкурирующие решения, которые клиент рассматривает или уже использует (массив). Включай и «нулевые» альтернативы: «ничего не делать», «оставить как есть», «своими силами / самописное». Пустой массив [], если конкурентов не называли.
- "decision_criteria": по каким критериям клиент будет выбирать (цена, интеграции, сроки внедрения, поддержка, безопасность и т.п.) — массив. Пустой массив [], если критерии не прозвучали.
- "what_hooked": на что клиент отреагировал положительно в продукте (конкретная функция/выгода, вызвавшая интерес), фразой; null, если явной положительной реакции не было.
- "main_blocker": главное узкое место сделки — что мешает двигаться дальше (бюджет не утверждён, нет ЛПР на встрече, сомнение в безопасности и т.п.), фразой; null, если блокеров не выявлено.
- "data_quality": 1–2 фразы о полноте данных встречи — насколько полный транскрипт, есть ли неопределённые спикеры, ненадёжные для распознавания места (числа/имена/термины); null, если оговорок нет.`;

export function buildPrompt(input: PromptInput): PromptOutput {
  return {
    system: withRoomChatNote(withToolInstructions(SYSTEM, TOOL_NAME), input.roomChat),
    user: `Тип встречи: sales\nЗаголовок: ${input.meeting.title}\n\nДиалог:\n${turnsToText(input.dialog, input.roomChat)}`,
  };
}

// Для Anthropic: enum без null отдельно, nullable enum через type=['string','null']
// тут не нужен — берём строку, но контролируем enum в Zod на парсе.
export const TOOL = buildExtractTool(
  TOOL_NAME,
  'Извлечь sales-отчёт',
  {
    pain: fieldNullableString,
    interest_level: {
      type: ['string', 'null'],
      enum: ['low', 'medium', 'high', null],
    },
    objections: fieldStringArray,
    budget: fieldNullableString,
    decision_maker: fieldNullableString,
    urgency: fieldNullableString,
    next_step: fieldString,
    competitors: fieldStringArray,
    decision_criteria: fieldStringArray,
    what_hooked: fieldNullableString,
    main_blocker: fieldNullableString,
    data_quality: fieldNullableString,
  },
  [
    'pain',
    'interest_level',
    'objections',
    'budget',
    'decision_maker',
    'urgency',
    'next_step',
    'competitors',
    'decision_criteria',
    'what_hooked',
    'main_blocker',
    'data_quality',
  ],
);

// Подавляем неиспользуемые имена (на случай будущих рефакторов).
void fieldEnum;
void fieldNullableEnum;
