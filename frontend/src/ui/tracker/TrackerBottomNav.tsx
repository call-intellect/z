'use client';

/**
 * TrackerBottomNav — нижняя навигация для мобильных устройств (≤md).
 *
 * 5 табов: Мои задачи / Проекты / Лента / Чек-ин / Профиль.
 * На больших экранах скрыт (sidebar заменяет).
 *
 * Wave 2 A8: бейдж непрочитанных задач на иконке «Инбокс». Подсветка через
 * `useMyInboxCount` — пока backend не отдаёт total, рисуем точку-индикатор
 * («есть/нет»), не цифру. См. шапку `useMyInboxCount.ts`.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Inbox,
  FolderKanban,
  Newspaper,
  CheckCircle2,
  User,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/ui/shadcn/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { useMyInboxCount } from '@/hooks/tracker/useMyInboxCount';

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Wave 2 A8: если true — рендерим badge непрочитанных. */
  withInboxBadge?: boolean;
};

const ITEMS: readonly NavItem[] = [
  { href: '/me/inbox', label: 'Мои задачи', icon: Inbox, withInboxBadge: true },
  { href: '/projects', label: 'Проекты', icon: FolderKanban },
  { href: '/feed', label: 'Лента', icon: Newspaper },
  { href: '/me/check-ins', label: 'Чек-ин', icon: CheckCircle2 },
  { href: '/me', label: 'Профиль', icon: User },
] as const;

export function TrackerBottomNav() {
  const pathname = usePathname() ?? '';
  const { currentOrgId } = useAuth();
  const { count, hasUnread, isLoading } = useMyInboxCount(currentOrgId);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border-subtle bg-bg-elevated md:hidden"
      aria-label="Главная навигация"
    >
      {ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        const showBadge = Boolean(item.withInboxBadge) && !isLoading && hasUnread;
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
            <span className="relative inline-flex">
              <Icon size={20} strokeWidth={active ? 2 : 1.75} />
              {showBadge ? (
                <span
                  className="absolute -right-1.5 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-bg-base"
                  aria-label={`Непрочитанных задач: ${count}`}
                >
                  {/* Backend пока не отдаёт точное число — рисуем индикатор-точку
                      (символ «·» визуально мельче цифры и не вводит в заблуждение). */}
                  {'·'}
                </span>
              ) : null}
            </span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
