import { z } from 'zod';

import {
  buildExtractTool,
  fieldNullableString,
  fieldStringArray,
  type PromptInput,
  type PromptOutput,
  turnsToText,
  withPeopleHypothesisGuard,
  withRoomChatNote,
  withToolInstructions,
} from './common';

export const TOOL_NAME = 'extract_review';

export const SCHEMA = z
  .object({
    subject: z.string().nullable(),
    went_well: z.array(z.string()),
    to_improve: z.array(z.string()),
    risks: z.array(z.string()),
    next_steps: z.array(z.string()),
    verdict: z.string().nullable(),
    decisions: z.array(z.string()).optional(),
    data_quality: z.string().nullable().optional(),
  })
  .strict();

export type ReviewReport = z.infer<typeof SCHEMA>;

const SYSTEM =
  withPeopleHypothesisGuard(`Ты — деловой ассистент. Это обзорная встреча (review) — ретроспективный разбор результата: фичи, спринта, проекта, документа или работы конкретного человека/команды.
Извлеки структурированный отчёт. Все поля — на русском, без оценочных суждений и без додумывания.
- "subject": что именно ревьюилось (короткой фразой) или null, если не названо явно.
- "went_well": что сделано хорошо — конкретные достижения, сильные стороны, удачные решения.
- "to_improve": что можно улучшить — слабые места, дефекты, упущения, технический долг.
- "risks": риски, выявленные на ревью (для проекта, для следующего цикла).
- "next_steps": конкретные следующие шаги или рекомендации, прозвучавшие на встрече.
- "verdict": общий вердикт одной фразой (например, «принято с замечаниями», «отправлено на доработку») или null.
Если поле пустое — вернуть пустой массив. Для строковых полей null допустим только там, где явно указано.

Само-проверка и различения:
to_improve — только то, что прозвучало явно, не твоя интерпретация. verdict обоснуй конкретной репликой. Пусто — честно «не зафиксировано».

Дополнительно:
- "decisions": конкретные решения, принятые на ревью по результату — «принято», «отклонено», «на доработку», «переделать раздел X». Только зафиксированные решения, не обсуждённые варианты. Пустой массив, если решений не зафиксировано.
- "data_quality": 1-2 фразы о полноте и надёжности входных данных — обрывы транскрипта, неразборчивые места, неопределённые спикеры, реплики без атрибуции. null, если данные полные и претензий нет.

ПРИМЕРЫ.

Положительный пример (что извлечь):
Транскрипт-фрагмент: «Лид: По спринту — релиз выкатили в срок, нагрузочные прошли. Бэкенд тормозил на ревью, очередь PR копилась. Решили: спринт принят с замечаниями, дашборд на доработку — переделать раздел метрик. Аналитик заметно тянул два потока сразу».
Вывод: {"subject": "спринт", "went_well": ["релиз выкатили в срок", "нагрузочные тесты прошли"], "to_improve": ["долгое ревью, очередь PR копилась"], "risks": [], "next_steps": ["переделать раздел метрик в дашборде"], "verdict": "принято с замечаниями", "decisions": ["спринт принят с замечаниями", "дашборд — на доработку"], "data_quality": null}. Пояснение: оценка человека дана гипотезно и приватно — «похоже, аналитик перегружен двумя потоками», а не «не справляется»; в decisions только зафиксированное («принято», «на доработку»).

Что НЕ делать (edge case — обсуждение без решения + жёсткий ярлык + обрезанный транскрипт):
Транскрипт-фрагмент: «Лид: Думали вынести кэш в Redis, поспорили — пока без вывода. Тестировщик опять всё провалил, ничего не успевает. [запись обрывается]».
Вывод: {"subject": null, "went_well": [], "to_improve": [], "risks": [], "next_steps": [], "verdict": null, "decisions": [], "data_quality": "Транскрипт обрывается, охвачен один спикер; решение по кэшу не зафиксировано — только обсуждение."}. Пояснение: «думали/поспорили, пока без вывода» — это обсуждение, не решение → не в decisions; ярлык «всё провалил, ничего не успевает» — приговор, его НЕ берём; при обрезке поля пустые честно, оговорка уходит в data_quality.`);

export function buildPrompt(input: PromptInput): PromptOutput {
  return {
    system: withRoomChatNote(withToolInstructions(SYSTEM, TOOL_NAME), input.roomChat),
    user: `Тип встречи: review\nЗаголовок: ${input.meeting.title}\n\nДиалог:\n${turnsToText(input.dialog, input.roomChat)}`,
  };
}

export const TOOL = buildExtractTool(
  TOOL_NAME,
  'Извлечь структурированный отчёт обзорной встречи (review)',
  {
    subject: fieldNullableString,
    went_well: fieldStringArray,
    to_improve: fieldStringArray,
    risks: fieldStringArray,
    next_steps: fieldStringArray,
    verdict: fieldNullableString,
    decisions: fieldStringArray,
    data_quality: fieldNullableString,
  },
  [
    'subject',
    'went_well',
    'to_improve',
    'risks',
    'next_steps',
    'verdict',
    'decisions',
    'data_quality',
  ],
);
