'use client';

/**
 * MobileTabBar — нижняя навигация по роли (ТЗ 2026-06-11
 * mobile-cora-exec-manager, Ф1, Б2).
 *
 * Отдельный компонент, НЕ `TrackerBottomNav`: тот заточен под трекер
 * (Входящие/Проекты/Лента/Чек-ины/Я) и остаётся для трекер-маршрутов.
 * Этот — role-aware (exec / manager наборы из `mobile-tabs.ts`).
 *
 * Показывается только ниже `md` (Б1). Набор табов выбирается по
 * `currentOrgRole`. Только русский UI; парные токены (accent / fg-*), без
 * `text-white` и hex.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useAuth } from '@/contexts/auth-context';
import { tabsForRole } from './mobile-tabs';
import { cn } from '@/ui/shadcn/lib/utils';

export function MobileTabBar() {
  const pathname = usePathname() ?? '';
  const { currentOrgRole } = useAuth();
  const tabs = tabsForRole(currentOrgRole);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border-subtle bg-bg-elevated md:hidden"
      aria-label="Мобильная навигация"
    >
      {tabs.map((tab) => {
        const active =
          pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] transition-colors',
              active ? 'text-accent' : 'text-fg-tertiary hover:text-fg-secondary',
            )}
            aria-current={active ? 'page' : undefined}
          >
            <Icon size={20} strokeWidth={active ? 2 : 1.75} aria-hidden />
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
