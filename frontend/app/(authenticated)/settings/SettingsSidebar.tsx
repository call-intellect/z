'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  Bell,
  Building2,
  Compass,
  Download,
  Palette,
  ShieldCheck,
  Tag,
  User,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

import { useAuth } from '@/contexts/auth-context';
import { cn } from '@/ui/shadcn/lib/utils';

type Item = {
  href: string;
  tab?: string;
  label: string;
  icon: LucideIcon;
  matchExact?: boolean;
};

const ITEMS: Item[] = [
  { href: '/settings', label: 'Профиль', icon: User, matchExact: true },
  { href: '/settings', tab: 'security', label: 'Безопасность', icon: ShieldCheck },
  { href: '/settings', tab: 'appearance', label: 'Внешний вид', icon: Palette },
  { href: '/settings', tab: 'tours', label: 'Знакомство', icon: Compass },
  { href: '/settings/organization', label: 'Организация', icon: Building2 },
  { href: '/settings/tags', label: 'Теги', icon: Tag },
  { href: '/settings/notifications', label: 'Уведомления', icon: Bell },
  { href: '/settings/exports', label: 'Экспорты', icon: Download },
];

const OWNER_ITEMS: Item[] = [
  { href: '/settings/subscription', label: 'Подписка и оплата', icon: Wallet },
  { href: '/settings/billing', label: 'Тариф и лимиты', icon: Wallet },
];

/**
 * Верхняя навигация «Настроек» — горизонтальные табы (ТЗ 2026-06-16: убираем
 * вложенное вертикальное меню рядом с главным). Интеграции переехали в
 * «Админка компании → Источники» (интеграция = источник), поэтому таба
 * «Интеграции» здесь больше нет.
 */
export function SettingsSidebar() {
  const pathname = usePathname() ?? '';
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab') ?? null;
  const { currentOrgRole } = useAuth();
  const showOwner = currentOrgRole === 'owner';

  const items = showOwner ? [...ITEMS, ...OWNER_ITEMS] : ITEMS;

  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-border-subtle">
      {items.map((item) => (
        <TabLink
          key={`${item.href}-${item.tab ?? 'default'}`}
          item={item}
          pathname={pathname}
          tabParam={tabParam}
        />
      ))}
    </nav>
  );
}

function TabLink({
  item,
  pathname,
  tabParam,
}: {
  item: Item;
  pathname: string;
  tabParam: string | null;
}) {
  const linkHref = item.tab ? `${item.href}?tab=${item.tab}` : item.href;
  const isActive = computeActive(item, pathname, tabParam);
  const Icon = item.icon;
  return (
    <Link
      href={linkHref}
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
}

function computeActive(item: Item, pathname: string, tab: string | null): boolean {
  if (item.href === '/settings' && pathname === '/settings') {
    if (item.matchExact) {
      return tab === null || tab === 'profile';
    }
    return tab === item.tab;
  }
  if (item.href !== '/settings') {
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  }
  return false;
}
