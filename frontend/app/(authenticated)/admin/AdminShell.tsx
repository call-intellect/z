'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode } from 'react';
import {
  Activity,
  Building2,
  CircleDollarSign,
  FlaskConical,
  Gauge,
  ListTree,
  Shield,
  Sparkles,
  Users,
} from 'lucide-react';

import { cn } from '@/ui/shadcn/lib/utils';

/**
 * AdminShell — общий шелл Z-Admin.
 *
 * Страницы внутри `/admin/*` рендерятся в правой колонке. Левая — навигация.
 * Защита доступа: каждая клиентская страница пытается загрузить данные через
 * apiClient — при 403 (super_admin_required) показывает empty-state «Нет прав».
 * Server-side guard на NextJS уровне не делаем — это реализуется через middleware
 * + cookie-проверку, которая уже работает в `(authenticated)`.
 */
const NAV: Array<{ href: string; label: string; icon: typeof Gauge; matchPrefix?: string }> = [
  { href: '/admin', label: 'Дашборд', icon: Gauge },
  { href: '/admin/usage/users', label: 'Пользователи', icon: Users },
  {
    href: '/admin/usage/functions',
    label: 'Функции LLM',
    icon: ListTree,
    matchPrefix: '/admin/usage/functions',
  },
  {
    href: '/admin/experiments',
    label: 'A/B-эксперименты',
    icon: FlaskConical,
    matchPrefix: '/admin/experiments',
  },
  { href: '/admin/llm-prices', label: 'Прайс-карта', icon: CircleDollarSign },
  { href: '/admin/orgs', label: 'Организации', icon: Building2 },
  { href: '/admin/health', label: 'Здоровье системы', icon: Activity },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '';

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-6 md:flex-row">
      <aside className="md:w-60 md:shrink-0">
        <div className="mb-3 flex items-center gap-2 px-3 text-sm font-semibold uppercase tracking-wider text-fg-tertiary">
          <Shield size={14} className="text-accent" />
          Z-Admin
        </div>
        <nav className="rounded-lg border border-border-subtle bg-bg-card p-2">
          <ul className="flex flex-col gap-0.5">
            {NAV.map((item) => {
              const Icon = item.icon;
              const isActive =
                item.href === '/admin'
                  ? pathname === '/admin'
                  : pathname === item.href ||
                    pathname.startsWith(`${item.matchPrefix ?? item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
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
        <div className="mt-3 px-3 text-xs text-fg-tertiary">
          <Sparkles size={11} className="mr-1 inline" />
          Глобальная админка super_admin
        </div>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
