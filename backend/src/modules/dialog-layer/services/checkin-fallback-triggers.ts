/**
 * ТЗ 2026-05-29 telegram-self-initiated-checkins §Backend.4 — fallback-эвристика
 * для распознавания «план/отчёт» при недоступности LLM.
 *
 * Используется ТОЛЬКО в `QueryClassifierService.classify` catch-блоке (когда
 * вся цепочка LLM-провайдеров отвалилась). На счастливом пути классификация
 * делается LLM-моделью через расширенный `dialog-classify` промпт.
 *
 * 5 morning + 5 evening самых очевидных триггеров. Поиск только в первых
 * 30 символах — чтобы не ловить «...напомни о плане на отпуск» как morning-план.
 *
 * Расположение: ТЗ изначально предлагал поместить файл в
 * `conversational/adapters/telegram-bot/`, но это вводит circular import
 * (`dialog-layer/query-classifier → conversational/telegram-bot/...`, в то время
 * как `telegram-bot.adapter.ts` сам импортит `QueryClassifierService`).
 * Решение: файл лежит в dialog-layer рядом с classifier'ом, где он реально
 * используется (Phase 1 §Backend.4 ТЗ).
 *
 * При расширении списка — синхронизировать с golden-фикстурами в
 * `classify.snapshot.spec.ts`.
 */

/** Триггеры утреннего плана. Поиск case-insensitive в начале сообщения. */
const MORNING_TRIGGERS: readonly string[] = [
  'план на день',
  'план на сегодня',
  'утренний план',
  'сегодня хочу',
  'на сегодня:',
];

/** Триггеры вечернего отчёта. Поиск case-insensitive в начале сообщения. */
const EVENING_TRIGGERS: readonly string[] = [
  'итоги дня',
  'отчёт за день',
  'отчет за день',
  'вечерний отчёт',
  'по итогам дня',
];

/** Лимит поиска от начала строки — 30 символов (см. ТЗ §Backend.4). */
const SEARCH_WINDOW = 30;

/**
 * Pure function: ищет триггер в первых 30 символах текста (case-insensitive).
 * Возвращает kind или null, если ничего не сработало.
 *
 * Намеренно строгая: 100 триггеров можно поймать LLM, но fallback ловит только
 * самые очевидные формулировки. Это страховка на 0.5-1% времени, когда LLM упал.
 */
export function checkinFallbackHeuristic(
  text: string,
): { kind: 'morning' | 'evening' } | null {
  if (!text || typeof text !== 'string') return null;
  const head = text.slice(0, SEARCH_WINDOW + 30).toLowerCase();
  for (const trigger of MORNING_TRIGGERS) {
    const idx = head.indexOf(trigger);
    if (idx >= 0 && idx <= SEARCH_WINDOW - trigger.length) {
      return { kind: 'morning' };
    }
  }
  for (const trigger of EVENING_TRIGGERS) {
    const idx = head.indexOf(trigger);
    if (idx >= 0 && idx <= SEARCH_WINDOW - trigger.length) {
      return { kind: 'evening' };
    }
  }
  return null;
}
