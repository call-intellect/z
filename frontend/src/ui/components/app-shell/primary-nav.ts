/**
 * PRIMARY_NAV_ITEMS — единый источник «ежедневной» навигации (daily drivers).
 *
 * ТЗ Ф6 (D4) 2026-06-11 navigation-single-source: и мобильный нижний навбар
 * (`TrackerBottomNav`), и десктоп-сайдбар берут «ежедневные» пункты ОТСЮДА,
 * чтобы гарантировать инвариант «mobile ⊆ desktop» (проверяется гард-тестом
 * `nav-subset.spec.ts`). Раньше списки дублировались и расходились.
 *
 * 5 пунктов — то, что пользователь открывает каждый день:
 *   Входящие · Проекты · Лента · Чек-ины · Я.
 *
 * Иконки — lucide, те же, что исторически использовал `TrackerBottomNav`.
 */

import {
  Inbox,
  FolderKanban,
  Newspaper,
  CheckCircle2,
  User,
  type LucideIcon,
} from 'lucide-react';

export interface PrimaryNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /**
   * Если true — у пункта рисуется бейдж непрочитанных входящих
   * (мобильный навбар — `useMyInboxCount`). На десктопе бейдж не дублируется.
   */
  withInboxBadge?: boolean;
}

export const PRIMARY_NAV_ITEMS: readonly PrimaryNavItem[] = [
  { href: '/me/inbox', label: 'Входящие', icon: Inbox, withInboxBadge: true },
  { href: '/projects', label: 'Проекты', icon: FolderKanban },
  { href: '/feed', label: 'Лента', icon: Newspaper },
  { href: '/me/check-ins', label: 'Чек-ины', icon: CheckCircle2 },
  { href: '/me', label: 'Я', icon: User },
] as const;
