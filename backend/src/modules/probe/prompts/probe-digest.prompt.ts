/**
 * Probe-система Фаза 3 (2026-06-11) — детерминированная сборка текста
 * батч-дайджеста probe.
 *
 * Дайджест — это группировка отложенных (deferrable, сверх бюджета) probe в
 * ОДНО уведомление получателю 1×/день вместо N точечных пингов (против
 * fatigue). Текст собирается ДЕТЕРМИНИРОВАННО (без LLM) — это просто список
 * уже готовых вопросов, лишний LLM-вызов тут не нужен и бьёт по бюджету.
 *
 * Кэш: LLM не используется → вопрос prompt-caching неприменим (нет вызова).
 */

export interface ProbeDigestItem {
  /** Готовый человеческий вопрос (без машинных кодов). */
  question: string;
  /** Название объекта, к которому относится вопрос (опц.). */
  objectTitle?: string;
  /** Id исходного ProbeEvent (для closing-loop/ack). */
  probeEventId: string;
}

/** Русское склонение «вопрос / вопроса / вопросов» по числу. */
function pluralizeVopros(n: number): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs >= 11 && abs <= 14) return 'вопросов';
  if (last === 1) return 'вопрос';
  if (last >= 2 && last <= 4) return 'вопроса';
  return 'вопросов';
}

/**
 * Собрать человеческий текст дайджеста (русский, без кодов). Используется как
 * `summary` в payload уведомления — его рендерят и каналы (telegram/max), и
 * кабинет (NotificationsClient читает `payload.summary`).
 */
export function buildProbeDigestSummary(items: readonly ProbeDigestItem[]): string {
  if (items.length === 0) return 'Кора пока без вопросов.';
  const head =
    items.length === 1
      ? 'Кора просит уточнить один момент:'
      : `Кора собрала ${items.length} ${pluralizeVopros(items.length)} — ответьте, когда будет минута:`;
  const lines = items.map((it, i) => {
    const obj = it.objectTitle ? ` (${it.objectTitle})` : '';
    return `${i + 1}. ${it.question}${obj}`;
  });
  return `${head}\n${lines.join('\n')}`;
}
