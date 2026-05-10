/**
 * Утилиты для admin / org-admin API-клиентов (Фаза 7).
 *
 * - `buildQuery` — собирает query-string из объекта (пропускает undefined / null / "").
 * - `orgHeaders(orgId)` — возвращает `{ 'X-Org-Id': orgId }` для org-scoped запросов.
 */

export function buildQuery(
  params: Record<string, string | number | boolean | undefined | null>,
): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.length === 0) continue;
    usp.set(k, String(v));
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : '';
}

export function orgHeaders(orgId: string): Record<string, string> {
  return { 'X-Org-Id': orgId };
}
