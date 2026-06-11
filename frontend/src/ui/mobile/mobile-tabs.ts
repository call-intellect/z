/**
 * Конфигурация мобильных табов по роли (ТЗ 2026-06-11 mobile-cora-exec-manager,
 * Ф1, Б2).
 *
 * Чистый модуль (без JSX/хуков) — чтобы выбор набора по роли тестировался
 * детерминированно (`mobile-tabs.spec.ts`), без рендера и сети.
 *
 * Наборы из Р2/Р3:
 *   - exec (owner/admin):  Обзор · Команда · Дела · Цели · Спросить
 *   - manager:             Моё · Чек-ин · Спросить · Память
 *
 * Приземление по роли (Б1): owner/admin → exec-«Обзор» (/dashboard);
 * manager → «Моё» (/me/daily-brief).
 *
 * ВАЖНО: для фундамента (Ф1) табы ведут на СУЩЕСТВУЮЩИЕ десктоп-маршруты —
 * мобильное содержимое разделов (Ф2–Ф6) — отдельные фазы. Где целевого экрана
 * ещё нет, указываем ближайший существующий маршрут (помечено в комментарии).
 */

import {
  LayoutDashboard,
  Users,
  ClipboardList,
  Target,
  MessageCircle,
  Sun,
  CheckCircle2,
  BookOpen,
  type LucideIcon,
} from 'lucide-react';

import type { CurrentOrgRole } from '@/domain/account';

export type MobileTabSet = 'exec' | 'manager';

export interface MobileTabItem {
  /** Стабильный ключ (для тестов и React key). */
  key: string;
  href: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Руководитель. «Обзор»→/dashboard (Ф2 заменит десктоп мобильной раскладкой
 * через gate на том же роуте). «Команда»/«Дела»/«Цели» пока ведут на
 * ближайшие существующие десктоп-разделы — мобильные экраны Ф3.
 */
export const EXEC_TABS: readonly MobileTabItem[] = [
  { key: 'overview', href: '/dashboard', label: 'Обзор', icon: LayoutDashboard },
  // [Ф3] мобильного раздела «Команда» ещё нет → операционная панель (десктоп).
  { key: 'team', href: '/dashboard/operations', label: 'Команда', icon: Users },
  // [Ф3] мобильного «Дела» ещё нет → недельный план-факт по людям (десктоп).
  { key: 'deals', href: '/dashboard/operations/weekly', label: 'Дела', icon: ClipboardList },
  { key: 'goals', href: '/goals', label: 'Цели', icon: Target },
  // [Ф5] first-class «Спросить» ещё нет → AI-чат «Помощник компании» (десктоп).
  { key: 'ask', href: '/chat', label: 'Спросить', icon: MessageCircle },
] as const;

/**
 * Менеджер. «Моё»→/me/daily-brief (готово, Ф0). «Чек-ин»→существующий поток.
 * «Спросить» и «Память» — ближайшие существующие маршруты до Ф5/Ф6.
 */
export const MANAGER_TABS: readonly MobileTabItem[] = [
  { key: 'my-day', href: '/me/daily-brief', label: 'Моё', icon: Sun },
  { key: 'checkin', href: '/me/check-ins', label: 'Чек-ин', icon: CheckCircle2 },
  // [Ф5] first-class «Спросить» ещё нет → AI-чат «Помощник компании» (десктоп).
  { key: 'ask', href: '/chat', label: 'Спросить', icon: MessageCircle },
  // [Ф6] мобильной «Памяти» ещё нет → лента решений (десктоп).
  { key: 'memory', href: '/decisions', label: 'Память', icon: BookOpen },
] as const;

/** owner/admin → exec; manager/coo/прочее → manager. */
export function tabSetForRole(role: CurrentOrgRole): MobileTabSet {
  if (role === 'owner' || role === 'admin') return 'exec';
  return 'manager';
}

export function tabsForRole(role: CurrentOrgRole): readonly MobileTabItem[] {
  return tabSetForRole(role) === 'exec' ? EXEC_TABS : MANAGER_TABS;
}

/**
 * Маршрут приземления по роли (Б1). owner/admin → exec-«Обзор» (/dashboard);
 * остальные → «Моё» (/me/daily-brief). Это первый таб соответствующего набора.
 */
export function landingHrefForRole(role: CurrentOrgRole): string {
  return tabsForRole(role)[0]!.href;
}
