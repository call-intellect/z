/**
 * Probe-система Фаза 5 (2026-06-11) — общие хелперы adaptive fatigue.
 *
 * Единый источник Redis-ключей и порогов, чтобы писатели и читатели не
 * разъехались по строкам:
 *   - engagement-снимок пишет ProbePriorityCron, читает
 *     ProbeService.filterByRateLimit (режет бюджет низко-отзывчивым);
 *   - cooldown темы пишут dispatcher (на dispatch) и cron (на ignored),
 *     читает ProbeService.suggest (не повторять тему в течение cooldown).
 */

/** Порог engagement_rate, ниже которого получателю режем бюджет. */
export const PROBE_LOW_ENGAGEMENT_THRESHOLD = 0.2;

/** Множитель бюджета для низко-отзывчивого получателя (≥1 слот всё равно). */
export const PROBE_LOW_ENGAGEMENT_BUDGET_FACTOR = 0.5;

/** TTL engagement-снимка в Redis (cron пересчитывает каждые 15 минут). */
export const PROBE_ENGAGEMENT_TTL_SEC = 7 * 24 * 3600;

/** Ключ engagement-снимка получателя. */
export function probeEngagementRedisKey(userId: string): string {
  return `probe:engagement:${userId}`;
}

/** Ключ cooldown темы (по contentHash) в пределах tenant'а. */
export function probeTopicCooldownRedisKey(
  tenantId: string,
  contentHash: string,
): string {
  return `probe:cooldown:${tenantId}:${contentHash}`;
}
