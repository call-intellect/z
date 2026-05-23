'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode } from 'react';
import {
  Activity,
  Bot,
  Building2,
  CircleDollarSign,
  FileText,
  FlaskConical,
  Gauge,
  KeyRound,
  LineChart,
  ListTree,
  MessagesSquare,
  PlayCircle,
  Plug,
  Shield,
  Sparkles,
  TrendingUp,
  Users,
  Video,
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
type NavItem = { href: string; label: string; icon: typeof Gauge; matchPrefix?: string };
type NavGroup = { title: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Обзор',
    items: [
      { href: '/admin', label: 'Дашборд', icon: Gauge },
      { href: '/admin/health', label: 'Здоровье системы', icon: Activity },
    ],
  },
  {
    title: 'Использование',
    items: [
      { href: '/admin/usage/users', label: 'Пользователи', icon: Users },
      {
        href: '/admin/usage/functions',
        label: 'Функции LLM',
        icon: ListTree,
        matchPrefix: '/admin/usage/functions',
      },
      { href: '/admin/ai-usage', label: 'AI-вызовы (legacy)', icon: Bot },
    ],
  },
  {
    title: 'Контент и AI',
    items: [
      {
        href: '/admin/prompts',
        label: 'Промпт-шаблоны',
        icon: MessagesSquare,
        matchPrefix: '/admin/prompts',
      },
      {
        href: '/admin/ai-models',
        label: 'Модели агентов',
        icon: Sparkles,
        matchPrefix: '/admin/ai-models',
      },
      {
        href: '/admin/experiments',
        label: 'A/B-эксперименты',
        icon: FlaskConical,
        matchPrefix: '/admin/experiments',
      },
      { href: '/admin/llm-prices', label: 'Прайс-карта', icon: CircleDollarSign },
      {
        href: '/admin/llm/providers',
        label: 'LLM провайдеры',
        icon: Plug,
        matchPrefix: '/admin/llm/providers',
      },
      {
        href: '/admin/llm/models',
        label: 'LLM модели',
        icon: Bot,
        matchPrefix: '/admin/llm/models',
      },
    ],
  },
  {
    title: 'Юнит-экономика',
    items: [
      {
        href: '/admin/economics',
        label: 'Глобальный дашборд',
        icon: TrendingUp,
        matchPrefix: '/admin/economics',
      },
      {
        href: '/admin/org/economics',
        label: 'Экономика моей Org',
        icon: LineChart,
      },
    ],
  },
  {
    title: 'Тенанты и медиа',
    items: [
      { href: '/admin/orgs', label: 'Организации', icon: Building2 },
      {
        href: '/admin/meetings',
        label: 'Все встречи',
        icon: Video,
        matchPrefix: '/admin/meetings',
      },
      {
        href: '/admin/recordings/expiring',
        label: 'Истекающие записи',
        icon: PlayCircle,
      },
      { href: '/admin/integration-keys', label: 'Integration keys', icon: KeyRound },
    ],
  },
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
          <div className="flex flex-col gap-3">
            {NAV_GROUPS.map((group) => (
              <div key={group.title}>
                <div className="mb-1 px-3 text-[10px] font-medium uppercase tracking-wider text-fg-tertiary">
                  {group.title}
                </div>
                <ul className="flex flex-col gap-0.5">
                  {group.items.map((item) => {
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
              </div>
            ))}
          </div>
        </nav>
        <div className="mt-3 flex items-center gap-1.5 px-3 text-xs text-fg-tertiary">
          <FileText size={11} />
          Глобальная админка super_admin
        </div>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
