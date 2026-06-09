/**
 * TZ-1 Фаза 4.A (daily-value-engine) — чистая логика ленты идей: ре-ранк +
 * морфинг статуса при закрытии связанной задачи.
 *
 * Без зависимостей от Prisma/NestJS — unit-тестируется без БД/времени.
 * Сделано ПО ОБРАЗЦУ insights.service.getTop (re-rank виджета), но для Idea:
 * вес идеи + свежесть обсуждения + связь с целью.
 */

import type { IdeaStatus } from '@prisma/client';

/** Параметры ре-ранка топа идей (источник — AdminSetting). */
export interface IdeasRerankWeights {
  /** Вклад нормированного `weight` идеи. */
  weight: number;
  /** Вклад свежести (`lastDiscussedAt`, чем свежее — тем выше). */
  freshness: number;
  /** Бонус за привязку к цели (`goalId != null`). */
  goalLink: number;
}

/** Дефолтные веса ре-ранка. */
export const DEFAULT_IDEAS_RERANK_WEIGHTS: IdeasRerankWeights = {
  weight: 1,
  freshness: 0.5,
  goalLink: 0.75,
};

/** Окно свежести (дней): идея, обсуждавшаяся `>= freshnessDays` назад, даёт 0. */
export const DEFAULT_IDEAS_FRESHNESS_DAYS = 30;

export interface IdeaRerankInput {
  id: string;
  weight: number;
  lastDiscussedAt: Date;
  goalId: string | null;
}

export interface IdeaRerankScored<T extends IdeaRerankInput> {
  item: T;
  score: number;
}

/**
 * Скор одной идеи. Чистая функция.
 *   - `weight` нормируется лог-сжатием (1 + ln(1 + weight)) — крупные веса не
 *     должны полностью подавлять свежесть/цель.
 *   - свежесть: линейный спад от 1 (сегодня) до 0 (>= freshnessDays назад).
 *   - бонус за goalLink — фиксированный, если есть `goalId`.
 */
export function scoreIdea(
  item: IdeaRerankInput,
  now: Date,
  weights: IdeasRerankWeights,
  freshnessDays: number,
): number {
  const w = safeNonNeg(item.weight);
  const weightTerm = Math.log1p(w) * safeNumber(weights.weight);

  const ageDays =
    (now.getTime() - item.lastDiscussedAt.getTime()) / 86_400_000;
  const fd = safeNonNeg(freshnessDays) || DEFAULT_IDEAS_FRESHNESS_DAYS;
  const freshnessRatio = clamp01(1 - safeNonNeg(ageDays) / fd);
  const freshnessTerm = freshnessRatio * safeNumber(weights.freshness);

  const goalTerm = item.goalId ? safeNumber(weights.goalLink) : 0;

  const score = weightTerm + freshnessTerm + goalTerm;
  return Math.round(score * 10_000) / 10_000;
}

/**
 * Ре-ранк списка идей по `weight` + свежесть + связь с целью. Чистая функция.
 * Стабильная сортировка по score desc, тай-брейкер — `weight` desc, затем `id`.
 */
export function rerankIdeas<T extends IdeaRerankInput>(
  items: T[],
  now: Date,
  weights: IdeasRerankWeights = DEFAULT_IDEAS_RERANK_WEIGHTS,
  freshnessDays: number = DEFAULT_IDEAS_FRESHNESS_DAYS,
): Array<IdeaRerankScored<T>> {
  const scored = items.map((item) => ({
    item,
    score: scoreIdea(item, now, weights, freshnessDays),
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const wa = safeNonNeg(a.item.weight);
    const wb = safeNonNeg(b.item.weight);
    if (wb !== wa) return wb - wa;
    return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0;
  });
  return scored;
}

// ───────────────────────── авто-морфинг статуса ─────────────────────────

/**
 * Линейный жизненный цикл идеи (без rejected/archived, которые ставит человек):
 *   captured → in_discussion → accepted → in_progress → shipped.
 */
export const IDEA_STATUS_LADDER: IdeaStatus[] = [
  'captured',
  'in_discussion',
  'accepted',
  'in_progress',
  'shipped',
];

/**
 * Следующий статус идеи при закрытии связанной задачи. Чистая функция.
 *
 * Правила:
 *   - если идея уже `shipped` / `rejected` / `archived` — терминал, `null`
 *     (ничего не двигаем).
 *   - закрытие задачи — сильный сигнал «гипотеза доведена». Если идея уже была
 *     `in_progress` — двигаем сразу в `shipped` (релиз). Иначе — на одну
 *     ступень вверх по лестнице.
 *
 * Возвращает `null`, если продвигать не нужно (терминал / неизвестный статус).
 */
export function nextIdeaStatusOnTaskClose(
  current: IdeaStatus,
): IdeaStatus | null {
  if (current === 'shipped' || current === 'rejected' || current === 'archived') {
    return null;
  }
  if (current === 'in_progress') return 'shipped';
  const idx = IDEA_STATUS_LADDER.indexOf(current);
  if (idx < 0) return null;
  const next = IDEA_STATUS_LADDER[idx + 1];
  return next ?? null;
}

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function safeNonNeg(v: unknown): number {
  const n = safeNumber(v);
  return n > 0 ? n : 0;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
