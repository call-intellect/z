'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  Bell,
  Brain,
  Building2,
  CircleDollarSign,
  Database,
  Download,
  Eye,
  KeyRound,
  Link2,
  Palette,
  Plug,
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
  { href: '/settings/organization', label: 'Организация', icon: Building2 },
  { href: '/settings/tags', label: 'Теги', icon: Tag },
  { href: '/settings/integrations', label: 'Интеграции', icon: Plug },
  { href: '/settings/notifications', label: 'Уведомления', icon: Bell },
  { href: '/settings/api', label: 'API ключи', icon: KeyRound },
  { href: '/settings/webhooks', label: 'Webhooks', icon: Bell },
  { href: '/settings/exports', label: 'Экспорты', icon: Download },
];

const ADMIN_ITEMS: Item[] = [
  { href: '/settings/admin/usage', label: 'Экономика', icon: CircleDollarSign },
  { href: '/settings/admin/knowledge-core', label: 'Ядро знаний', icon: Brain },
  // ТЗ 2026-05-26 §6 — доступ к разделам «Памяти компании» для member.
  { href: '/settings/admin/memory-access', label: 'Доступ к памяти', icon: Eye },
  { href: '/settings/sources', label: 'Источники', icon: Link2 },
];

const OWNER_ITEMS: Item[] = [
  { href: '/settings/billing', label: 'Тариф и лимиты', icon: Wallet },
  { href: '/settings/retention', label: 'Хранение и 152-ФЗ', icon: Database },
];

export function SettingsSidebar() {
  const pathname = usePathname() ?? '';
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab') ?? null;
  const { currentOrgRole } = useAuth();
  const showAdmin = currentOrgRole === 'owner' || currentOrgRole === 'admin';
  const showOwner = currentOrgRole === 'owner';

  return (
    <aside className="md:w-56 md:shrink-0">
      <nav className="rounded-lg border border-border-subtle bg-bg-card p-2">
        <ul className="flex flex-col gap-0.5">
          {ITEMS.map((item) => (
            <SidebarLink
              key={`${item.href}-${item.tab ?? 'default'}`}
              item={item}
              pathname={pathname}
              tabParam={tabParam}
            />
          ))}
        </ul>
        {showAdmin && (
          <>
            <div className="mt-3 px-3 text-[10px] font-semibold uppercase tracking-wider text-fg-tertiary">
              Админка
            </div>
            <ul className="flex flex-col gap-0.5 pt-1">
              {ADMIN_ITEMS.map((item) => (
                <SidebarLink
                  key={`${item.href}-${item.tab ?? 'default'}`}
                  item={item}
                  pathname={pathname}
                  tabParam={tabParam}
                />
              ))}
            </ul>
          </>
        )}
        {showOwner && (
          <>
            <div className="mt-3 px-3 text-[10px] font-semibold uppercase tracking-wider text-fg-tertiary">
              Владелец Org
            </div>
            <ul className="flex flex-col gap-0.5 pt-1">
              {OWNER_ITEMS.map((item) => (
                <SidebarLink
                  key={`${item.href}-${item.tab ?? 'default'}`}
                  item={item}
                  pathname={pathname}
                  tabParam={tabParam}
                />
              ))}
            </ul>
          </>
        )}
      </nav>
    </aside>
  );
}

function SidebarLink({
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
    <li>
      <Link
        href={linkHref}
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
