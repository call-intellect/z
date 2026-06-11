/**
 * Чистая логика мобильного экрана «Дела» (ТЗ B2/Ф3
 * `2026-06-11-remaining-handoff-finishable-now.md` блок B).
 *
 * Вынесена из `MobileDealsClient` отдельным модулем (без JSX/хуков/сети), чтобы
 * детерминированно тестировать: вычисление понедельника недели, агрегат
 * «команда держит слово», ряды «кому помочь» и «молодцы».
 *
 * Инвариант: читаем ТОЛЬКО существующую доменную модель `WeeklyPerPersonUi`
 * (`weekly-per-person.ts`), backend-расчёты НЕ дублируем. Финансы не появляются.
 *
 * Р4 (КРИТИЧНО): фокус «кому помочь», БЕЗ публичного «кто провалил». Низкая
 * надёжность подаётся как «нужна поддержка», НЕ как обвинение «провалил/
 * просрочил/не сдал».
 */

import type { StatusTone } from '@/ui/mobile/shared/StatusDot';
import type {
  WeeklyPerPersonUi,
  WeeklyPersonRowUi,
} from '@/domain/weekly-per-person';
import { reliabilityDisplay } from '@/domain/weekly-per-person';

/** Строка для DrillList (id/title/meta/tone/href) — re-export формы примитива. */
export interface DealsRow {
  id: string;
  title: string;
  meta?: string;
  tone?: StatusTone;
  href?: string;
}

/**
 * Понедельник недели, в которую попадает `date`, в формате `YYYY-MM-DD`
 * (локальная зона). Неделя НАЧИНАЕТСЯ С ПОНЕДЕЛЬНИКА: воскресенье относится к
 * той же неделе, что и предыдущий понедельник (а не к следующей).
 *
 * `getDay()`: 0=вс, 1=пн … 6=сб. Сдвиг до понедельника:
 *   - пн (1) → 0 дней назад;
 *   - вт (2) → 1; … сб (6) → 5;
 *   - вс (0) → 6 дней назад (а НЕ 0 — иначе воскресенье уехало бы в новую неделю).
 *
 * Чистая функция без внешних либ; работает по локальным компонентам даты,
 * поэтому стабильна к переходу через границу месяца/года.
 */
export function weekStartMonday(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay(); // 0..6, 0=вс
  const diffToMonday = (day + 6) % 7; // вс→6, пн→0, вт→1, …
  d.setDate(d.getDate() - diffToMonday);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Каноническая ссылка на персону (роут существует: /structure/persons/[id]). */
function personHref(personId: string): string {
  return `/structure/persons/${encodeURIComponent(personId)}`;
}

/**
 * Средняя надёжность команды за неделю, % 0..100 или null.
 *
 * Бэкенд НЕ присылает готового агрегата, поэтому считаем сами по строкам с
 * рассчитанной надёжностью (`reliabilityPercent !== null`). Если ни у кого
 * надёжность не посчитана (мало данных / нет обещаний) → null → «нет данных».
 */
export function teamAverageReliabilityPercent(
  ui: WeeklyPerPersonUi | null,
): number | null {
  if (!ui) return null;
  const scored = ui.rows.filter((r) => r.reliabilityPercent !== null);
  if (scored.length === 0) return null;
  const sum = scored.reduce((acc, r) => acc + (r.reliabilityPercent ?? 0), 0);
  return Math.round(sum / scored.length);
}

/** Тон агрегата надёжности (≥80 ok, ≥60 warn, иначе danger; null → neutral). */
export function reliabilityTone(percent: number | null): StatusTone {
  if (percent === null) return 'neutral';
  if (percent >= 80) return 'ok';
  if (percent >= 60) return 'warn';
  return 'danger';
}

/**
 * «Кому помочь» — люди под угрозой по надёжности обещаний (`topRisk`).
 *
 * Р4: НЕ «провалил/просрочил». Каждой строке — заботливая мета:
 *   - надёжность посчитана → «нужна помощь · NN%»;
 *   - мало данных → «мало данных, поддержать»;
 *   - нет обещаний → строку не показываем (нечем помогать по надёжности).
 * Тон всегда warn (внимание, не тревога-обвинение).
 */
export function dealsHelpRows(ui: WeeklyPerPersonUi | null): DealsRow[] {
  if (!ui) return [];
  const rows: DealsRow[] = [];
  for (const r of ui.topRisk) {
    const disp = reliabilityDisplay(r);
    if (disp.kind === 'none') continue; // нет обещаний — нечем помогать
    const meta =
      disp.kind === 'percent'
        ? `нужна помощь · ${disp.label}`
        : 'мало данных, поддержать';
    rows.push({
      id: r.personId,
      title: r.personName || 'Без имени',
      meta,
      tone: 'warn',
      href: personHref(r.personId),
    });
  }
  return rows;
}

/**
 * «Молодцы» — люди, держащие слово (`topReliable` с посчитанной надёжностью).
 * Позитивная рамка, тон ok, мета — процент надёжности.
 */
export function dealsReliableRows(ui: WeeklyPerPersonUi | null): DealsRow[] {
  if (!ui) return [];
  const rows: DealsRow[] = [];
  for (const r of ui.topReliable) {
    const disp = reliabilityDisplay(r);
    if (disp.kind !== 'percent') continue; // в «молодцы» только с реальным %
    rows.push({
      id: r.personId,
      title: r.personName || 'Без имени',
      meta: disp.label,
      tone: 'ok',
      href: personHref(r.personId),
    });
  }
  return rows;
}

/** Истина, если данных по неделе нет вовсе (cold-start / пустая неделя). */
export function isDealsEmpty(ui: WeeklyPerPersonUi | null): boolean {
  if (!ui) return true;
  return ui.total === 0 && ui.rows.length === 0;
}

export type { WeeklyPersonRowUi };
