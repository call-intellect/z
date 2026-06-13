/**
 * PRIMARY_NAV_ITEMS — единый источник «ежедневной» навигации (daily drivers).
 *
 * ТЗ Ф6 (D4) 2026-06-11 navigation-single-source: и мобильный нижний навбар
 * (`TrackerBottomNav`), и десктоп-сайдбар берут «ежедневные» пункты ОТСЮДА,
 * чтобы гарантировать инвариант «mobile ⊆ desktop» (проверяется гард-тестом
 * `nav-subset.spec.ts`). Раньше списки дублировались и расходились.
 *
 * 5 пунктов — то, что пользователь открывает каждый день:
 *   Входящие · Задачи · Спросить · Чек-ины · Я.
 *
 * ТЗ 2026-06-13 «Редизайн кабинета», Ф0: заглушка «Лента» (/feed) убрана из
 * меню (заменяется «Памятью» /memory в Ф5б); вместо неё в ежедневном наборе —
 * «Спросить» (/chat), достижимый и в десктопе (РАБОТА рядового).
 *
 * Иконки — lucide, те же, что исторически использовал `TrackerBottomNav`.
 */

import {
  Inbox,
  FolderKanban,
  MessageCircle,
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
  { href: '/projects', label: 'Задачи', icon: FolderKanban },
  { href: '/chat', label: 'Спросить', icon: MessageCircle },
  { href: '/me/check-ins', label: 'Чек-ины', icon: CheckCircle2 },
  { href: '/me', label: 'Я', icon: User },
] as const;
