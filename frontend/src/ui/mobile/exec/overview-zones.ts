/**
 * Чистая логика экрана «Обзор» руководителя (мобайл, ТЗ B1/Ф2
 * `2026-06-11-remaining-handoff-finishable-now.md` блок B).
 *
 * Вынесена из `MobileOverviewClient` отдельным модулем (без JSX/хуков/сети),
 * чтобы детерминированно тестировать раскладку 4 зон, строку «Требует тебя»
 * и cold-start — без рендера и моков SWR.
 *
 * Инвариант: читаем ТОЛЬКО существующие доменные модели
 * (`DirectorDashboardDomain` + `OperationsOverviewDomain`), backend-расчёты НЕ
 * дублируем. Финансы/себестоимость в зонах не появляются.
 */

import type { DirectorDashboardDomain } from '@/domain/director-dashboard';
import type { OperationsOverviewDomain } from '@/domain/operations-dashboard';

/** Тон зоны → парные токены (`bg-chip-{tone}-bg` + `text-chip-{tone}-fg`). */
export type ZoneTone = 'ok' | 'warn' | 'danger' | 'neutral';

/** Одна зона-плитка экрана «Обзор». */
export interface OverviewZone {
  /** Стабильный ключ (React key + поиск в тесте). */
  key: 'team' | 'deals' | 'goal' | 'blockers';
  title: string;
  /** Крупное значение (строка — потому что бывает «—», «%», «нет данных»). */
  value: string;
  caption?: string;
  tone: ZoneTone;
  href: string;
  /**
   * Для зоны «Главная цель» — процент 0..100 для полукруглого индикатора
   * (`GlanceGauge`). null → «нет данных». Для остальных зон undefined.
   */
  gaugePercent?: number | null;
}

/** Тон «здоровья команды» по доле зелёных чек-инов (0..1). */
function teamTone(greenShare: number, totalCheckIns: number): ZoneTone {
  if (totalCheckIns === 0) return 'neutral';
  if (greenShare >= 0.7) return 'ok';
  if (greenShare >= 0.4) return 'warn';
  return 'danger';
}

/** Тон «надёжности обещаний» по проценту 0..100. */
function reliabilityTone(percent: number | null): ZoneTone {
  if (percent === null) return 'neutral';
  if (percent >= 80) return 'ok';
  if (percent >= 60) return 'warn';
  return 'danger';
}

/** Тон «согласованности с главной целью» по проценту 0..100. */
function alignmentTone(percent: number | null): ZoneTone {
  if (percent === null) return 'neutral';
  if (percent >= 70) return 'ok';
  if (percent >= 40) return 'warn';
  return 'danger';
}

/**
 * Сколько действий ждёт лично руководителя. Берём `requiresAction.total`
 * (готовый серверный счётчик pending-подтверждений). Если блок не пришёл
 * (старый backend) — суммируем `signalCounters` как ближайший сигнал «есть на
 * что посмотреть». 0 → строка «Требует тебя» НЕ показывается.
 */
export function requiresYouCount(director: DirectorDashboardDomain | null): number {
  if (!director) return 0;
  if (director.requiresAction) return director.requiresAction.total;
  const c = director.signalCounters;
  if (!c) return 0;
  return (
    c.pain +
    c.feature_request +
    c.churn_risk +
    c.objection +
    c.risk +
    c.decision +
    c.commitment +
    c.other
  );
}

/**
 * «Согласованность с главной целью», % 0..100 или null.
 *   1) `strategicAlignment.average` (0..1 средняя по целям) → ×100;
 *   2) иначе из `goalsPulse`: доля on-track среди не-dropped целей;
 *   3) иначе null → «нет данных».
 */
export function mainGoalPercent(director: DirectorDashboardDomain | null): number | null {
  if (!director) return null;
  const avg = director.strategicAlignment?.average;
  if (avg !== null && avg !== undefined) return Math.round(avg * 100);
  const pulse = director.goalsPulse;
  if (pulse && pulse.total > 0) {
    const denom = pulse.total - pulse.droppedCount;
    if (denom > 0) return Math.round((pulse.onTrackCount / denom) * 100);
  }
  return null;
}

/** «Надёжность обещаний», % 0..100 или null (KPI commitmentReliability). */
export function commitmentReliabilityPercent(
  director: DirectorDashboardDomain | null,
): number | null {
  const v = director?.kpiCommitmentReliability?.value;
  return v === null || v === undefined ? null : Math.round(v);
}

/**
 * Собирает 4 зоны экрана «Обзор» из доменных моделей. Чистая функция —
 * сердце экрана и предмет юнит-теста.
 *
 * Зоны (Б4 ТЗ): Команда · Дела · Главная цель · Что мешает.
 */
export function overviewZonesFromDomain(
  director: DirectorDashboardDomain | null,
  operations: OperationsOverviewDomain | null,
): OverviewZone[] {
  // ── Команда: доля «зелёных» настроений за неделю.
  const temp = operations?.teamTemperature;
  const greenShare = temp?.greenShare ?? 0;
  const totalCheckIns = temp?.totalCheckIns ?? 0;
  const greenPct = Math.round(greenShare * 100);
  const teamZone: OverviewZone = {
    key: 'team',
    title: 'Команда',
    value: operations ? (totalCheckIns > 0 ? `${greenPct}%` : '—') : '—',
    caption: totalCheckIns > 0 ? 'в добром настрое' : 'нет чек-инов за неделю',
    tone: teamTone(greenShare, totalCheckIns),
    href: '/dashboard/operations',
  };

  // ── Дела: надёжность обещаний (слово держим / нет).
  const reliability = commitmentReliabilityPercent(director);
  const dealsZone: OverviewZone = {
    key: 'deals',
    title: 'Дела',
    value: reliability === null ? '—' : `${reliability}%`,
    caption: 'обещания держим',
    tone: reliabilityTone(reliability),
    href: '/dashboard/operations/weekly',
  };

  // ── Главная цель: согласованность стратегии (полукруг GlanceGauge).
  const goalPct = mainGoalPercent(director);
  const goalZone: OverviewZone = {
    key: 'goal',
    title: 'Главная цель',
    value: goalPct === null ? 'нет данных' : `${goalPct}%`,
    caption: 'движемся к цели',
    tone: alignmentTone(goalPct),
    href: '/goals',
    gaugePercent: goalPct,
  };

  // ── Что мешает: открытые блокеры команды.
  const blockers = operations?.blockersCount ?? 0;
  const blockersZone: OverviewZone = {
    key: 'blockers',
    title: 'Что мешает',
    value: operations ? String(blockers) : '—',
    caption: blockers > 0 ? 'активных блокеров' : 'блокеров нет',
    tone: blockers > 0 ? 'danger' : operations ? 'ok' : 'neutral',
    href: '/dashboard/operations',
  };

  return [teamZone, dealsZone, goalZone, blockersZone];
}

/** Истина, если граф пуст (cold-start Р6) — показываем индикатор наполнения. */
export function isOverviewColdStart(
  director: DirectorDashboardDomain | null,
): boolean {
  return director?.isEmpty === true;
}
