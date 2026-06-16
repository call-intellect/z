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
 * Верхняя навигация «Админки компании» — горизонтальные табы (ТЗ 2026-06-16:
 * убираем вложенное вертикальное меню рядом с главным).
 *
 * Видна только owner/admin Org; для остальных ролей скрыта, а контент-страницы
 * показывают empty-state по 403 от бэка.
 */
export function CompanyAdminSidebar() {
  const pathname = usePathname() ?? '';
  const { currentOrgRole } = useAuth();
  const canSee = currentOrgRole === 'owner' || currentOrgRole === 'admin';

  if (!canSee) return null;

  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-border-subtle">
      {ITEMS.map((item) => {
        const isActive =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              '-mb-px flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm transition-colors',
              isActive
                ? 'border-accent font-medium text-fg-primary'
                : 'border-transparent text-fg-secondary hover:text-fg-primary',
            )}
          >
            <Icon size={15} strokeWidth={1.75} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
