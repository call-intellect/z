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

/**
 * Промпт для типа встречи `review` — обзорная встреча по работе / проекту /
 * результату (см. enum MeetingType в schema.prisma).
 *
 * CRIT-2 (2026-05-24): до этого `review` fallback'ился на `team.buildPrompt`
 * в `prompts/index.ts`. Это приводило к потере фокуса — обзорная встреча
 * фундаментально отличается: ретроспективная оценка результата,
 * а не оперативное обсуждение задач.
 *
 * См. plans/analysis/2026-05-22-code-reality-deltas.md §CRIT-2.
 */
export const TOOL_NAME = 'extract_review';

export const SCHEMA = z
  .object({
    /** Что именно ревьюилось (фича/спринт/проект/документ/результат). */
    subject: z.string().nullable(),
    /** Что сделано хорошо — конкретные достижения и сильные стороны. */
    went_well: z.array(z.string()),
    /** Что можно улучшить — слабые места, дефекты, упущения. */
    to_improve: z.array(z.string()),
    /** Риски на следующий цикл / для проекта. */
    risks: z.array(z.string()),
    /** Конкретные следующие шаги / рекомендации после ревью. */
    next_steps: z.array(z.string()),
    /** Общая оценка/вердикт по результату (одной фразой), либо null. */
    verdict: z.string().nullable(),
    /** Принятые на ревью решения (принято / отклонено / на доработку). */
    decisions: z.array(z.string()).optional(),
    /** Заметка о полноте и надёжности входных данных или null. */
    data_quality: z.string().nullable().optional(),
  })
  .strict();

export type ReviewReport = z.infer<typeof SCHEMA>;

// A5 (2026-06-10): review может разбирать работу конкретного человека/команды,
// поэтому в КОНЕЦ статического SYSTEM (cache-friendly) дописываем
// `withPeopleHypothesisGuard` — оценки людей формулируются как гипотезы по
// наблюдаемому, а не как вердикт. Tool-инструкция добавляется поверх в buildPrompt.
const SYSTEM = withPeopleHypothesisGuard(`Ты — деловой ассистент. Это обзорная встреча (review) — ретроспективный разбор результата: фичи, спринта, проекта, документа или работы конкретного человека/команды.
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
- "data_quality": 1-2 фразы о полноте и надёжности входных данных — обрывы транскрипта, неразборчивые места, неопределённые спикеры, реплики без атрибуции. null, если данные полные и претензий нет.`);

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
