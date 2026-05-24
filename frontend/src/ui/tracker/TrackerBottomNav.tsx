'use client';

/**
 * TrackerBottomNav — нижняя навигация для мобильных устройств (≤md).
 *
 * 5 табов: Инбокс / Проекты / Лента / Чек-ин / Профиль.
 * На больших экранах скрыт (sidebar заменяет).
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Inbox,
  FolderKanban,
  Newspaper,
  CheckCircle2,
  User,
} from 'lucide-react';
import { cn } from '@/ui/shadcn/lib/utils';

const ITEMS = [
  { href: '/me/inbox', label: 'Инбокс', icon: Inbox },
  { href: '/projects', label: 'Проекты', icon: FolderKanban },
  { href: '/feed', label: 'Лента', icon: Newspaper },
  { href: '/me/check-ins', label: 'Чек-ин', icon: CheckCircle2 },
  { href: '/me', label: 'Профиль', icon: User },
] as const;

export function TrackerBottomNav() {
  const pathname = usePathname() ?? '';
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border-subtle bg-bg-elevated md:hidden"
      aria-label="Главная навигация"
    >
      {ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] transition-colors',
              active
                ? 'text-accent'
                : 'text-fg-tertiary hover:text-fg-secondary',
            )}
            aria-current={active ? 'page' : undefined}
          >
            <Icon size={20} strokeWidth={active ? 2 : 1.75} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
