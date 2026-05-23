/**
 * SBA δ-2 — helper для anti-spam dedup-key ProactiveWatcher.
 *
 * Возвращает локальную дату в формате `YYYY-MM-DD` (UTC по умолчанию).
 * Используется как часть Redis-key `proactive:dedup:{tenantId}:{userId}:{dateLocal}`.
 *
 * NB: для МVP считаем по UTC — per-user TZ-awareness придёт в γ+ (как и в
 * `DailyCheckInPromptCron`'е). Для anti-spam «1 раз в день» этого достаточно.
 */
export function getProactiveLocalDate(now: Date = new Date()): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
