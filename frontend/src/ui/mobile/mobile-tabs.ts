/**
 * Конфигурация мобильных табов по роли.
 *
 * ТЗ 2026-06-13 «Редизайн кабинета», Ф9 — наборы табов теперь берутся из
 * ЕДИНОГО `nav-config.ts` (тот же источник, что и десктоп-сайдбар), чтобы
 * инвариант «mobile ⊆ desktop» (`nav-subset.spec.ts`) держался автоматически.
 *
 * Чистый модуль (без JSX/хуков) — выбор набора по роли тестируется
 * детерминированно (`mobile-tabs.spec.ts`).
 *
 * Наборы (Ф9):
 *   - exec (owner/admin):  Сегодня · Неделя · Требует вас · Память · Я
 *   - manager (остальные): Сегодня · Чек-ин · Спросить · Дела
 *
 * Приземление по роли (Б1): owner/admin → exec-«Сегодня» (/dashboard);
 * остальные → «Сегодня» (/me).
 */

import type { CurrentOrgRole } from '@/domain/account';
import {
  MOBILE_EXEC_TABS,
  MOBILE_MANAGER_TABS,
  type MobileNavTab,
} from '@/ui/components/app-shell/nav-config';

export type MobileTabSet = 'exec' | 'manager';

/** Алиас формы пункта (ключ/href/label/icon) — совместимость с прежним API. */
export type MobileTabItem = MobileNavTab;

export const EXEC_TABS: readonly MobileTabItem[] = MOBILE_EXEC_TABS;
export const MANAGER_TABS: readonly MobileTabItem[] = MOBILE_MANAGER_TABS;

/** owner/admin → exec; manager/coo/прочее → manager. */
export function tabSetForRole(role: CurrentOrgRole): MobileTabSet {
  if (role === 'owner' || role === 'admin') return 'exec';
  return 'manager';
}

export function tabsForRole(role: CurrentOrgRole): readonly MobileTabItem[] {
  return tabSetForRole(role) === 'exec' ? EXEC_TABS : MANAGER_TABS;
}

/**
 * Маршрут приземления по роли (Б1). owner/admin → exec-«Сегодня» (/dashboard);
 * остальные → «Сегодня» (/me). Это первый таб соответствующего набора.
 */
export function landingHrefForRole(role: CurrentOrgRole): string {
  return tabsForRole(role)[0]!.href;
}
