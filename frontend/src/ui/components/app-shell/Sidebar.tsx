'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  CalendarDays,
  ChevronDown,
  FolderKanban,
  Home,
  ListChecks,
  LogOut,
  MessageCircle,
  Plug,
  Plus,
  Settings,
  Shapes,
  Sparkles,
  User,
  KeyRound,
  type LucideIcon,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/ui/shadcn/avatar';
import { Button } from '@/ui/shadcn/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/ui/shadcn/dropdown-menu';
import { Separator } from '@/ui/shadcn/separator';
import { cn } from '@/ui/shadcn/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { useTheme } from '@/ui/components/theme/ThemeProvider';

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  matchPrefix?: string;
};

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Главная', icon: Home, matchPrefix: '/dashboard' },
  { href: '/cards', label: 'Карточки', icon: FolderKanban, matchPrefix: '/cards' },
  { href: '/themes', label: 'AI-темы', icon: Sparkles, matchPrefix: '/themes' },
  { href: '/chat', label: 'AI-чат', icon: MessageCircle, matchPrefix: '/chat' },
  { href: '/meetings', label: 'Мои встречи', icon: CalendarDays, matchPrefix: '/meetings' },
  { href: '/tasks', label: 'Задачи', icon: ListChecks, matchPrefix: '/tasks' },
  { href: '/settings/templates', label: 'Шаблоны', icon: Shapes, matchPrefix: '/settings/templates' },
  { href: '/settings/integrations', label: 'Интеграции', icon: Plug, matchPrefix: '/settings/integrations' },
  { href: '/settings', label: 'Настройки', icon: Settings, matchPrefix: '/settings' },
];

export function Sidebar({
  className,
  onNavigate,
}: {
  className?: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        'flex h-full w-sb shrink-0 flex-col border-r border-border-subtle bg-bg-elevated',
        className,
      )}
    >
      {/* Logo */}
      <div className="flex h-header items-center px-5">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="flex items-center gap-2"
          aria-label="На главную"
        >
          <div className="grid h-7 w-7 place-items-center rounded-md bg-accent font-mono text-sm font-bold text-accent-fg shadow-glow-mint">
            Z
          </div>
          <span className="text-lg font-semibold tracking-tight text-fg-primary">Z</span>
        </Link>
      </div>

      {/* CTA */}
      <div className="px-3 pb-3">
        <Button asChild className="w-full justify-start gap-2" size="default">
          <Link href="/meetings/create" onClick={onNavigate}>
            <Plus size={16} strokeWidth={2} />
            Создать встречу
          </Link>
        </Button>
      </div>

      <Separator />

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-2">
        <ul className="flex flex-col gap-0.5">
          {(() => {
            // Выбираем наиболее специфичный matchPrefix, чтобы /settings/integrations
            // не подсвечивал ОДНОВРЕМЕННО /settings/integrations и /settings.
            const candidates = NAV_ITEMS.map((item, idx) => ({
              idx,
              prefix: item.matchPrefix ?? item.href,
              matches:
                pathname === item.href ||
                (item.matchPrefix
                  ? pathname === item.matchPrefix ||
                    pathname.startsWith(`${item.matchPrefix}/`)
                  : false),
            })).filter((c) => c.matches);
            const winnerIdx = candidates.length
              ? candidates.reduce((a, b) => (b.prefix.length > a.prefix.length ? b : a)).idx
              : -1;
            return NAV_ITEMS.map((item, idx) => {
            const isActive = idx === winnerIdx;
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-accent-muted font-medium text-accent'
                      : 'text-fg-secondary hover:bg-bg-overlay hover:text-fg-primary',
                  )}
                >
                  <Icon
                    size={16}
                    strokeWidth={1.75}
                    className={isActive ? 'text-accent' : undefined}
                  />
                  {item.label}
                </Link>
              </li>
            );
          });
          })()}
        </ul>
      </nav>

      <Separator />

      {/* User card */}
      <div className="p-2">
        <UserCard onAfterAction={onNavigate} />
      </div>
    </aside>
  );
}

function UserCard({ onAfterAction }: { onAfterAction?: () => void }) {
  const { user, logout } = useAuth();
  const { setTheme, resolvedTheme } = useTheme();
  const router = useRouter();

  const handleLogout = async () => {
    await logout();
    onAfterAction?.();
    router.push('/login');
  };

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((p) => p[0])
        .filter(Boolean)
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : user?.email?.slice(0, 2).toUpperCase() ?? '?';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-md p-2 text-left transition-colors hover:bg-bg-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Avatar className="h-8 w-8">
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-fg-primary">
              {user?.name ?? 'Гость'}
            </div>
            <div className="truncate text-xs text-fg-tertiary">
              {user?.email ?? '—'}
            </div>
          </div>
          <ChevronDown size={14} className="shrink-0 text-fg-tertiary" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-56">
        <DropdownMenuLabel>Аккаунт</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href="/settings" onClick={onAfterAction} className="flex items-center gap-2">
            <User size={14} />
            Профиль
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings?tab=security" onClick={onAfterAction} className="flex items-center gap-2">
            <KeyRound size={14} />
            Сменить пароль
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            Тема
            <span className="ml-auto pr-1 text-xs text-fg-tertiary capitalize">
              {resolvedTheme}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={() => setTheme('dark')}>Тёмная</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setTheme('light')}>Светлая</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setTheme('system')}>Системная</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            void handleLogout();
          }}
          className="text-danger focus:text-danger"
        >
          <LogOut size={14} />
          Выйти
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
