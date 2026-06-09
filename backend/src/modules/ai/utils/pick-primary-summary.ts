/**
 * Каноническая сводка встречи: summaryFast (новый) > summaryV2 (A/B) > summary (legacy).
 *
 * ТЗ 2026-06-07 agent-chain-overhaul, Фаза 5 / Р6 — консолидация summary в
 * единый источник `meeting-report-fast`. Все прямые потребители `AiResult.summary`
 * читают через этот хелпер, чтобы не зависеть от legacy summary-агента.
 *
 * NB: каждый Prisma-`select`/`include`, питающий этот хелпер, обязан тянуть
 * `summaryFast` и `summaryV2` (иначе селектор молча упадёт на legacy `summary`).
 */
export function pickPrimarySummary(r: {
  summaryFast?: string | null;
  summaryV2?: string | null;
  summary?: string | null;
}): string {
  return r.summaryFast?.trim() || r.summaryV2?.trim() || r.summary?.trim() || '';
}
