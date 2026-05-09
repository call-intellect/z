'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  Bell,
  Download,
  KeyRound,
  Palette,
  Plug,
  ShieldCheck,
  Tag,
  User,
  type LucideIcon,
} from 'lucide-react';

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
  { href: '/settings/tags', label: 'Теги', icon: Tag },
  { href: '/settings/integrations', label: 'Интеграции', icon: Plug },
  { href: '/settings/api', label: 'API ключи', icon: KeyRound },
  { href: '/settings/webhooks', label: 'Webhooks', icon: Bell },
  { href: '/settings/exports', label: 'Экспорты', icon: Download },
];

export function SettingsSidebar() {
  const pathname = usePathname() ?? '';
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab') ?? null;

  return (
    <aside className="md:w-56 md:shrink-0">
      <nav className="rounded-lg border border-border-subtle bg-bg-card p-2">
        <ul className="flex flex-col gap-0.5">
          {ITEMS.map((item) => {
            const linkHref = item.tab ? `${item.href}?tab=${item.tab}` : item.href;
            const isActive = computeActive(item, pathname, tabParam);
            const Icon = item.icon;
            return (
              <li key={`${item.href}-${item.tab ?? 'default'}`}>
                <Link
                  href={linkHref}
                  className={cn(
                    'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-accent-muted font-medium text-accent'
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
