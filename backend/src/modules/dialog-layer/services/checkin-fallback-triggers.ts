const MORNING_TRIGGERS: readonly string[] = [
  'план на день',
  'план на сегодня',
  'утренний план',
  'сегодня хочу',
  'на сегодня:',
];

const EVENING_TRIGGERS: readonly string[] = [
  'итоги дня',
  'отчёт за день',
  'отчет за день',
  'вечерний отчёт',
  'по итогам дня',
];

const SEARCH_WINDOW = 30;

export function checkinFallbackHeuristic(text: string): { kind: 'morning' | 'evening' } | null {
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
