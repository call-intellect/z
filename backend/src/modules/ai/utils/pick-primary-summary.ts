/**
 * Каноническая сводка встречи: summaryFast (новый) > summary (legacy).
 *
 * ТЗ 2026-06-07 agent-chain-overhaul, Фаза 5 / Р6 — консолидация summary в
 * единый источник `meeting-report-fast`. Все прямые потребители `AiResult.summary`
 * читают через этот хелпер, чтобы не зависеть от legacy summary-агента.
 *
 * NB: каждый Prisma-`select`/`include`, питающий этот хелпер, обязан тянуть
 * `summaryFast` (иначе селектор молча упадёт на legacy `summary`).
 *
 * v2-ветка (`summaryV2`) удалена 2026-06-10 вместе с мёртвым v2-стеком; колонка
 * `AiResult.summaryV2` остаётся в БД (миграция не делалась), но больше не читается.
 */
export function pickPrimarySummary(r: {
  summaryFast?: string | null;
  summary?: string | null;
}): string {
  return r.summaryFast?.trim() || r.summary?.trim() || '';
}
