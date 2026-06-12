/**
 * Чистая логика мобильного экрана «Цели» (ТЗ B2/Ф3
 * `2026-06-11-remaining-handoff-finishable-now.md` блок B).
 *
 * Вынесена из `MobileGoalsClient` отдельным модулем (без JSX/хуков/сети), чтобы
 * детерминированно тестировать выбор «главной цели» и ряды ключевых результатов.
 *
 * Источник — ТОТ ЖЕ, что у десктопного `GoalsClient`: `goalsApi.list(orgId,
 * {status:'active'})` → `goalFromApi` → `GoalDomain[]`. Backend-расчёты НЕ
 * дублируем. Прогресс цели = `cachedAlignment` (0..100), как на десктопе.
 */

import type { StatusTone } from '@/ui/mobile/shared/StatusDot';
import type { GoalDomain } from '@/domain/goal';

/** Строка для DrillList (id/title/meta/tone/href). */
export interface GoalsRow {
  id: string;
  title: string;
  meta?: string;
  tone?: StatusTone;
  href?: string;
}

/**
 * Главная цель списка. Берём цель с НАИБОЛЬШИМ весом (`weight`), при равном
 * весе — первую по порядку (десктоп грузит уже отсортированный список). Если
 * целей нет → null (cold-start экрана). Архивные/выпавшие сюда не попадают:
 * экран грузит только активные (`status:'active'`).
 */
export function mainGoal(goals: readonly GoalDomain[]): GoalDomain | null {
  if (goals.length === 0) return null;
  let best = goals[0];
  for (const g of goals) {
    if (g.weight > best.weight) best = g;
  }
  return best;
}

/** Прогресс главной цели для GlanceGauge: cachedAlignment 0..100 или null. */
export function mainGoalPercent(goal: GoalDomain | null): number | null {
  if (!goal || goal.cachedAlignment === null) return null;
  return Math.round(Math.max(0, Math.min(100, goal.cachedAlignment)));
}

/** Тон прогресса по проценту (≥70 ok, ≥40 warn, иначе danger; null → neutral). */
export function goalTone(percent: number | null): StatusTone {
  if (percent === null) return 'neutral';
  if (percent >= 70) return 'ok';
  if (percent >= 40) return 'warn';
  return 'danger';
}

/**
 * «Ключевые результаты» = остальные цели списка (название + прогресс), кроме
 * главной. На уровне списка целей KR как отдельная сущность не приходит
 * (`GoalListItemApi` без keyResults), поэтому в роли KR на этом экране —
 * подчинённые/прочие активные цели компании с их движением. Drill → /goals/[id].
 */
export function goalsKeyRows(
  goals: readonly GoalDomain[],
  mainId: string | null,
): GoalsRow[] {
  return goals
    .filter((g) => g.id !== mainId)
    .map((g) => {
      const pct = g.cachedAlignment === null ? null : Math.round(g.cachedAlignment);
      return {
        id: g.id,
        title: g.name,
        meta: pct === null ? 'нет данных' : `${pct}%`,
        tone: goalTone(pct),
        href: `/goals/${encodeURIComponent(g.id)}`,
      };
    });
}
