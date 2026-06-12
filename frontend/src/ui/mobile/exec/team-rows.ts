/**
 * Чистая логика мобильного экрана «Команда» (ТЗ B2/Ф3
 * `2026-06-11-remaining-handoff-finishable-now.md` блок B).
 *
 * Вынесена из `MobileTeamClient` отдельным модулем (без JSX/хуков/сети), чтобы
 * детерминированно тестировать: настроение команды (светофор), ряды «кому
 * помочь» (блокеры + перегруженные), сводные числа.
 *
 * Инвариант: читаем ТОЛЬКО существующую доменную модель
 * `OperationsOverviewDomain` (`operations-dashboard.ts`), backend-расчёты НЕ
 * дублируем. Финансы не появляются.
 *
 * Р4 (КРИТИЧНО): фокус «кому помочь», нейтрально-заботливая подача. В строках
 * НЕТ «провалил/просрочил/не сдал» как обвинения — блокер у человека = повод
 * поддержать, а не обвинить.
 */

import type { StatusTone } from '@/ui/mobile/shared/StatusDot';
import type { OperationsOverviewDomain } from '@/domain/operations-dashboard';

/** Строка для DrillList (id/title/meta/tone/href). */
export interface TeamRow {
  id: string;
  title: string;
  meta?: string;
  tone?: StatusTone;
  href?: string;
}

/** Каноническая ссылка на персону (роут /structure/persons/[id] существует). */
function personHref(personId: string | null): string | undefined {
  return personId ? `/structure/persons/${encodeURIComponent(personId)}` : undefined;
}

/** Тон настроения по доле зелёных чек-инов (0..1). 0 чек-инов → neutral. */
export function moodTone(greenShare: number, totalCheckIns: number): StatusTone {
  if (totalCheckIns === 0) return 'neutral';
  if (greenShare >= 0.7) return 'ok';
  if (greenShare >= 0.4) return 'warn';
  return 'danger';
}

/** Процент «в добром настрое» 0..100 или null (нет чек-инов). */
export function moodGreenPercent(ui: OperationsOverviewDomain | null): number | null {
  const temp = ui?.teamTemperature;
  if (!temp || temp.totalCheckIns === 0) return null;
  return Math.round(temp.greenShare * 100);
}

/**
 * «Кому помочь» — собирает заботливые строки: сначала свежие блокеры (у кого
 * затык), затем недавние командные трения (кому тяжело во взаимодействии).
 *
 * Р4: подача нейтрально-заботливая. Блокер → «нужна помощь», трение → «нужно
 * сгладить». Никаких «провалил/просрочил».
 *
 * Drill: если у блокера есть `ownerPersonId` — ссылка на персону; иначе строка
 * без href (нельзя выдумывать роут).
 */
export function teamHelpRows(ui: OperationsOverviewDomain | null): TeamRow[] {
  if (!ui) return [];
  const rows: TeamRow[] = [];

  for (const b of ui.topRecentBlockers) {
    const ownerName = b.ownerPersonName || b.ownerHint || null;
    const tone: StatusTone = b.severity === 'high' ? 'danger' : 'warn';
    rows.push({
      id: `blocker-${b.id}`,
      title: b.text,
      meta: ownerName ? `${ownerName} · нужна помощь` : 'нужна помощь',
      tone,
      href: personHref(b.ownerPersonId),
    });
  }

  for (const f of ui.topRecentTeamFrictions) {
    const from = f.fromPersonName || 'участник';
    const to = f.toPersonName || 'коллега';
    rows.push({
      id: `friction-${f.id}`,
      title: `${from} ↔ ${to}`,
      meta: 'нужно сгладить',
      tone: 'warn',
      href: personHref(f.fromPersonId),
    });
  }

  return rows;
}

/** Сводная плитка (заголовок/значение/тон) для блока чисел команды. */
export interface TeamStat {
  key: 'blockers' | 'frictions' | 'overloaded';
  title: string;
  value: number;
  caption: string;
  tone: StatusTone;
}

/**
 * Сводные числа команды: открытые блокеры, командные трения, перегруженные по
 * capacity. Тон danger при >0 для блокеров/трений (повод заняться), warn для
 * перегруза, иначе ok.
 */
export function teamSummaryStats(ui: OperationsOverviewDomain | null): TeamStat[] {
  if (!ui) return [];
  return [
    {
      key: 'blockers',
      title: 'Блокеры',
      value: ui.blockersCount,
      caption: ui.blockersCount > 0 ? 'активных' : 'нет',
      tone: ui.blockersCount > 0 ? 'danger' : 'ok',
    },
    {
      key: 'frictions',
      title: 'Трения',
      value: ui.teamFrictionCount,
      caption: ui.teamFrictionCount > 0 ? 'в команде' : 'нет',
      tone: ui.teamFrictionCount > 0 ? 'warn' : 'ok',
    },
    {
      key: 'overloaded',
      title: 'Перегружены',
      value: ui.capacityOverloadedCount,
      caption: ui.capacityOverloadedCount > 0 ? 'нужна разгрузка' : 'нет',
      tone: ui.capacityOverloadedCount > 0 ? 'warn' : 'ok',
    },
  ];
}

/**
 * Истина, если по операционке данных нет вовсе (cold-start). Считаем пустым,
 * когда нет чек-инов и нет ни блокеров, ни трений.
 */
export function isTeamEmpty(ui: OperationsOverviewDomain | null): boolean {
  if (!ui) return true;
  return (
    ui.teamTemperature.totalCheckIns === 0 &&
    ui.blockersCount === 0 &&
    ui.teamFrictionCount === 0 &&
    ui.topRecentBlockers.length === 0 &&
    ui.topRecentTeamFrictions.length === 0
  );
}
