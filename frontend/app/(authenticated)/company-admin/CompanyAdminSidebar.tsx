'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CalendarDays,
  Eye,
  Link2,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

import { useAuth } from '@/contexts/auth-context';
import { cn } from '@/ui/shadcn/lib/utils';

type Item = {
  href: string;
  label: string;
  icon: LucideIcon;
};

const ITEMS: Item[] = [
  { href: '/company-admin/memory-access', label: 'Доступ к памяти', icon: Eye },
  {
    href: '/company-admin/access-groups',
    label: 'Группы доступа',
    icon: ShieldCheck,
  },
  { href: '/company-admin/sources', label: 'Источники', icon: Link2 },
  { href: '/company-admin/meetings', label: 'Встречи', icon: CalendarDays },
];

/**
 * Левый сайдбар «Админки компании» (ТЗ 2026-06-02 — развод «Настройки»/«Админка»).
 *
 * Отдельная навигация, не переиспользует `SettingsSidebar` — этим лечится баг
 * двойного сайдбара. Видна только owner/admin Org; для остальных ролей сайдбар
 * скрыт, а контент-страницы показывают empty-state по 403 от бэка.
 */
export function CompanyAdminSidebar() {
  const pathname = usePathname() ?? '';
  const { currentOrgRole } = useAuth();
  const canSee = currentOrgRole === 'owner' || currentOrgRole === 'admin';

  if (!canSee) return null;

  return (
    <aside className="md:w-56 md:shrink-0">
      <nav className="rounded-lg border border-border-subtle bg-bg-card p-2">
        <div className="mb-1 px-3 pt-1 text-[10px] font-semibold uppercase tracking-wider text-fg-tertiary">
          Админка компании
        </div>
        <ul className="flex flex-col gap-0.5">
          {ITEMS.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-accent-muted font-medium text-accent-fg'
                      : 'text-fg-secondary hover:bg-bg-overlay hover:text-fg-primary',
                  )}
                >
                  <Icon size={15} strokeWidth={1.75} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
