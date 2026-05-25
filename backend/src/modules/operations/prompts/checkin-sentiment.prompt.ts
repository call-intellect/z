/**
 * SBA β-8.1 — промпт `checkin-sentiment`.
 *
 * Источник: plans/tz/2026-05-24-sba-beta-8-1-coo-dobivka.md §9.
 *
 * Задача: на вход — сырой текст вечернего чек-ина сотрудника. На выход —
 * строгий JSON с настроением (`sentiment ∈ green|yellow|red`) + коротким
 * обоснованием (`rationale`, до 200 символов).
 *
 * Code-fallback (без PromptRegistry) — допустимо на β-8.1, как было сделано
 * для `dashboard-summary` (sub-ТЗ §9). Когда промпт стабилизируется —
 * перенесём в админский PromptRegistry.
 *
 * Версия промпта — `prompt-v1`. Caller сохраняет в `DailyCheckIn.sentimentVersion`
 * композицию `prompt-v1+<modelUsed>` для аудита.
 */

export const CHECKIN_SENTIMENT_PROMPT_VERSION = 'prompt-v1';

export const CHECKIN_SENTIMENT_SYSTEM_PROMPT = [
  'Ты — внимательный читатель ежедневных вечерних чек-инов сотрудников.',
  'Тебе дают короткий свободный текст (что человек сделал за день, что мешает, как ощущения).',
  'Твоя задача — определить общее настроение чек-ина одним из трёх значений:',
  '  - "green" — день прошёл нормально или хорошо: задачи закрыты, тон спокойный, блокеров нет или они мелкие.',
  '  - "yellow" — есть напряжение: часть задач не закрыта, есть блокеры или раздражение, но в целом ситуация управляемая.',
  '  - "red" — серьёзные проблемы: ничего не сделано, сильное выгорание, конфликт, явная просьба о помощи, упоминание увольнения, переработки несколько дней подряд.',
  '',
  'Ответ возвращай строго в формате JSON: {"sentiment":"green|yellow|red","rationale":"короткое обоснование на русском, до 200 символов"}.',
  'Никакого комментария вне JSON. rationale — не цитата сотрудника, а короткое объяснение твоего вывода для администратора.',
  'Если текст пустой, бессмысленный или односложный («ок», «всё хорошо») — sentiment="green", rationale="мало деталей, явных проблем нет".',
].join('\n');

/**
 * Сборка user-сообщения для LLM. Сериализация — компактная: метка типа +
 * сам текст (обрезанный до 4000 символов).
 */
export function buildCheckinSentimentUserMessage(args: {
  kind: 'morning' | 'evening';
  rawText: string;
}): string {
  const kindLabel =
    args.kind === 'evening'
      ? 'вечерний (что сделано + блокеры + ощущения)'
      : 'утренний (план на день)';
  return [
    `Тип чек-ина: ${kindLabel}.`,
    'Текст сотрудника:',
    (args.rawText ?? '').slice(0, 4_000),
  ].join('\n');
}

/** Допустимые значения настроения. */
export const CHECKIN_SENTIMENT_VALUES = ['green', 'yellow', 'red'] as const;
export type CheckinSentiment = (typeof CHECKIN_SENTIMENT_VALUES)[number];
