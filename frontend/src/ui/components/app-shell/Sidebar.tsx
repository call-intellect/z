'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Brain,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock4,
  FileText,
  FolderKanban,
  Gauge,
  Home,
  IdCard,
  ListChecks,
  Lock,
  LogOut,
  MessageCircle,
  Network,
  Plug,
  Plus,
  Scale,
  Settings,
  Settings2,
  Shapes,
  Shield,
  Sparkles,
  Target,
  User,
  UserRound,
  Workflow,
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/ui/shadcn/tooltip';
import { cn } from '@/ui/shadcn/lib/utils';
import { useAuth } from '@/contexts/auth-context';
import { useEntitlement } from '@/hooks/useEntitlement';
import {
  FEATURE_MIN_TIER,
  tierLabel,
  type FeatureKey,
} from '@/domain/entitlement';
import { useTheme } from '@/ui/components/theme/ThemeProvider';
import { OrgSwitcher } from './OrgSwitcher';

/**
 * Sidebar — главный навигационный каркас ЛК (Фаза 0c, sub-TZ 0c.1).
 *
 * Структура — 3 смысловые группы + admin-подгруппа (см. §5.1 ТЗ 0c):
 *   - «Компания» — стратегический срез: дашборд, структура, документы,
 *     карты должностей, темы, цели. Внутри — свёрнутая подгруппа
 *     «Будет в следующей фазе» с 4 disabled-γ-пунктами.
 *   - «Оперативка» — ежедневная работа: встречи, дамп, карточки, задачи,
 *     помощник, личная страница.
 *   - «Настройки» — конфиг + админка (последняя видна только owner/admin).
 *
 * Состояния пункта (порядок проверки: comingSoon → locked → enabled):
 *   - `comingSoon=true` — функционал ещё не реализован (Фаза γ). Иконка
 *     `Clock4` справа, opacity-60, кликабелен — ведёт на preview-страницу
 *     через `<ComingSoonPage />`.
 *   - `gateFeature` + не оплачен тариф — иконка `Lock` справа, клик ведёт
 *     на `/settings/billing`, tooltip «Доступно на тарифе ...».
 *   - Обычное состояние — стандартный `<Link>`.
 */

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  matchPrefix?: string;
  /**
   * Если задано — пункт гейтится на feature. На закрытом тарифе пункт
   * остаётся видим, иконка-замок справа, tooltip и редирект на
   * `/settings/billing` вместо целевого URL (Фаза 12 шаг 10).
   */
  gateFeature?: FeatureKey;
  /**
   * Если true — функционал ещё не реализован (Фаза γ). Пункт остаётся
   * кликабельным (ведёт на preview-страницу), но визуально приглушён,
   * с иконкой `Clock4` справа вместо `Lock` (Фаза 0c §5.2).
   */
  comingSoon?: boolean;
};

type NavGroup = {
  label: string;
  items: NavItem[];
  collapsibleSubgroup?: {
    label: string;
    items: NavItem[];
    defaultCollapsed: boolean;
  };
};

const COMPANY_GROUP: NavGroup = {
  label: 'Компания',
  items: [
    { href: '/dashboard', label: 'Главная', icon: Home, matchPrefix: '/dashboard' },
    { href: '/structure', label: 'Структура', icon: Network, matchPrefix: '/structure' },
    { href: '/documents', label: 'Документы', icon: FileText, matchPrefix: '/documents' },
    { href: '/roles', label: 'Карты должностей', icon: IdCard, matchPrefix: '/roles' },
    {
      href: '/themes',
      label: 'Темы',
      icon: Sparkles,
      matchPrefix: '/themes',
      gateFeature: 'feature.theme',
    },
    {
      href: '/goals',
      label: 'Цели и стратегия',
      icon: Target,
      matchPrefix: '/goals',
      gateFeature: 'feature.goals_strategy',
    },
  ],
  collapsibleSubgroup: {
    label: 'Будет в следующей фазе',
    defaultCollapsed: true,
    items: [
      { href: '/processes', label: 'Процессы', icon: Workflow, matchPrefix: '/processes', comingSoon: true },
      { href: '/regulations', label: 'Регламенты', icon: ClipboardList, matchPrefix: '/regulations', comingSoon: true },
      { href: '/policies', label: 'Политики', icon: Scale, matchPrefix: '/policies', comingSoon: true },
      { href: '/metrics', label: 'Метрики', icon: Gauge, matchPrefix: '/metrics', comingSoon: true },
    ],
  },
};

const OPERATIONS_GROUP: NavGroup = {
  label: 'Оперативка',
  items: [
    { href: '/meetings', label: 'Встречи', icon: CalendarDays, matchPrefix: '/meetings' },
    { href: '/dump', label: 'Дамп', icon: Brain, matchPrefix: '/dump' },
    { href: '/cards', label: 'Карточки', icon: FolderKanban, matchPrefix: '/cards' },
    { href: '/tasks', label: 'Задачи', icon: ListChecks, matchPrefix: '/tasks' },
    {
      href: '/chat',
      label: 'Помощник компании',
      icon: MessageCircle,
      matchPrefix: '/chat',
      gateFeature: 'feature.chat_org',
    },
    { href: '/me', label: 'Я', icon: UserRound, matchPrefix: '/me' },
  ],
};

const SETTINGS_BASE_ITEMS: NavItem[] = [
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
  const pathname = usePathname() ?? '';
  const { isSuperAdmin, currentOrgRole } = useAuth();

  // Динамические admin-пункты (Фаза 7) — отдельная подгруппа в «Настройках».
  const adminItems: NavItem[] = [];
  if (currentOrgRole === 'owner' || currentOrgRole === 'admin') {
    adminItems.push({
      href: '/settings/admin',
      label: 'Админка компании',
      icon: Settings2,
      matchPrefix: '/settings/admin',
    });
  }
  if (isSuperAdmin) {
    adminItems.push({
      href: '/admin',
      label: 'Z-Admin',
      icon: Shield,
      matchPrefix: '/admin',
    });
  }

  const settingsGroup: NavGroup = {
    label: 'Настройки',
    items: SETTINGS_BASE_ITEMS,
    ...(adminItems.length
      ? {
          collapsibleSubgroup: {
            label: 'Админка',
            defaultCollapsed: false,
            items: adminItems,
          },
        }
      : {}),
  };

  const groups: NavGroup[] = [COMPANY_GROUP, OPERATIONS_GROUP, settingsGroup];

  // Собираем все пункты в один плоский массив, чтобы вычислить «победителя»
  // по matchPrefix один раз — поведение, как было в плоском Sidebar (см.
  // оригинальный код, фильтр по самому специфичному matchPrefix).
  const allItems: NavItem[] = groups.flatMap((g) => [
    ...g.items,
    ...(g.collapsibleSubgroup?.items ?? []),
  ]);

  const candidates = allItems
    .map((item) => ({
      href: item.href,
      prefix: item.matchPrefix ?? item.href,
      matches:
        pathname === item.href ||
        (item.matchPrefix
          ? pathname === item.matchPrefix ||
            pathname.startsWith(`${item.matchPrefix}/`)
          : false),
    }))
    .filter((c) => c.matches);
  const winnerHref = candidates.length
    ? candidates.reduce((a, b) => (b.prefix.length > a.prefix.length ? b : a))
        .href
    : null;

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

      {/* Org switcher (Фаза 0c §5.3) — между логотипом и CTA */}
      <div className="px-3 pb-2">
        <OrgSwitcher variant="sidebar" />
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
        <TooltipProvider delayDuration={150}>
          {groups.map((group, idx) => (
            <SidebarGroup
              key={group.label}
              group={group}
              winnerHref={winnerHref}
              onNavigate={onNavigate}
              showSeparator={idx > 0}
            />
          ))}
        </TooltipProvider>
      </nav>

      <Separator />

      {/* User card */}
      <div className="p-2">
        <UserCard onAfterAction={onNavigate} />
      </div>
    </aside>
  );
}

function SidebarGroup({
  group,
  winnerHref,
  onNavigate,
  showSeparator,
}: {
  group: NavGroup;
  winnerHref: string | null;
  onNavigate?: () => void;
  showSeparator: boolean;
}) {
  return (
    <div>
      {showSeparator && <Separator className="my-2" />}
      <div className="mt-3 mb-1 px-3 text-xs uppercase tracking-wider text-fg-tertiary">
        {group.label}
      </div>
      <ul className="flex flex-col gap-0.5">
        {group.items.map((item) => (
          <SidebarNavLink
            key={item.href}
            item={item}
            isActive={winnerHref === item.href}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
      {group.collapsibleSubgroup && (
        <SidebarSubgroup
          subgroup={group.collapsibleSubgroup}
          winnerHref={winnerHref}
          onNavigate={onNavigate}
        />
      )}
    </div>
  );
}

function SidebarSubgroup({
  subgroup,
  winnerHref,
  onNavigate,
}: {
  subgroup: NonNullable<NavGroup['collapsibleSubgroup']>;
  winnerHref: string | null;
  onNavigate?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(subgroup.defaultCollapsed);
  // Если внутри подгруппы есть активный пункт — раскрываем автоматически.
  const hasActive = subgroup.items.some((i) => i.href === winnerHref);
  const effectiveCollapsed = hasActive ? false : collapsed;

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs uppercase tracking-wider text-fg-tertiary transition-colors',
          'hover:bg-bg-overlay hover:text-fg-secondary',
        )}
        aria-expanded={!effectiveCollapsed}
      >
        {effectiveCollapsed ? (
          <ChevronRight size={12} className="shrink-0" />
        ) : (
          <ChevronDown size={12} className="shrink-0" />
        )}
        <span className="flex-1 text-left">{subgroup.label}</span>
      </button>
      {!effectiveCollapsed && (
        <ul className="mt-0.5 flex flex-col gap-0.5">
          {subgroup.items.map((item) => (
            <SidebarNavLink
              key={item.href}
              item={item}
              isActive={winnerHref === item.href}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Один пункт навигации с поддержкой тариф-гейтинга (Фаза 12 шаг 10) и
 * нового состояния `comingSoon` (Фаза 0c §5.2).
 *
 * Порядок проверки: `comingSoon → locked → enabled`.
 *
 * Поведение для `comingSoon=true`:
 *   - href — реальный (preview-страница типа /processes).
 *   - opacity-60, text-fg-tertiary, иконка `Clock4` справа.
 *   - tooltip «Появится в Фазе γ».
 *   - тариф-замок НЕ показывается (раз функционала ещё нет — гейтинг бессмыслен).
 *
 * Поведение для `gateFeature` (если comingSoon=false):
 *   - loading или enabled — обычный Link на item.href.
 *   - !enabled — пункт остаётся видим, визуально приглушён, иконка `Lock`,
 *     tooltip «Доступно на тарифе X», клик ведёт на `/settings/billing`.
 */
function SidebarNavLink({
  item,
  isActive,
  onNavigate,
}: {
  item: NavItem;
  isActive: boolean;
  onNavigate?: () => void;
}) {
  const gate = useEntitlement(
    // Хук всегда вызываем — иначе нарушим rules-of-hooks. Если gateFeature
    // не задан, передаём «всегда true»-фичу `feature.meeting`.
    item.gateFeature ?? 'feature.meeting',
  );
  const Icon = item.icon;
  const isComingSoon = item.comingSoon === true;
  const gateActive = item.gateFeature !== undefined && !isComingSoon;
  const locked = gateActive && !gate.loading && !gate.enabled;

  const baseClass =
    'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors';

  let stateClass: string;
  if (isActive) {
    stateClass = 'bg-accent-muted font-medium text-accent';
  } else if (isComingSoon) {
    stateClass =
      'text-fg-tertiary opacity-60 hover:bg-bg-overlay/60 hover:text-fg-secondary hover:opacity-100';
  } else if (locked) {
    stateClass = 'text-fg-tertiary hover:bg-bg-overlay/60 hover:text-fg-secondary';
  } else {
    stateClass = 'text-fg-secondary hover:bg-bg-overlay hover:text-fg-primary';
  }

  const iconClass = cn(
    'shrink-0',
    isActive
      ? 'text-accent'
      : isComingSoon || locked
      ? 'text-fg-tertiary/70'
      : undefined,
  );

  // comingSoon ведёт на свой preview-href; locked — на billing.
  const href = isComingSoon
    ? item.href
    : locked
    ? '/settings/billing'
    : item.href;

  const requiredTier =
    !isComingSoon && item.gateFeature
      ? FEATURE_MIN_TIER[item.gateFeature] ?? 'tier_pro'
      : null;

  const linkContent = (
    <>
      <Icon size={16} strokeWidth={1.75} className={iconClass} />
      <span className="flex-1 truncate">{item.label}</span>
      {isComingSoon && (
        <Clock4
          size={12}
          strokeWidth={2}
          className="shrink-0 text-fg-tertiary/70"
          aria-hidden
        />
      )}
      {!isComingSoon && locked && (
        <Lock
          size={12}
          strokeWidth={2}
          className="shrink-0 text-fg-tertiary/70"
          aria-hidden
        />
      )}
    </>
  );

  const linkNode = (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(baseClass, stateClass)}
      aria-disabled={locked || undefined}
    >
      {linkContent}
    </Link>
  );

  if (isComingSoon) {
    return (
      <li>
        <Tooltip>
          <TooltipTrigger asChild>{linkNode}</TooltipTrigger>
          <TooltipContent side="right">Появится в Фазе γ</TooltipContent>
        </Tooltip>
      </li>
    );
  }

  if (locked && requiredTier) {
    return (
      <li>
        <Tooltip>
          <TooltipTrigger asChild>{linkNode}</TooltipTrigger>
          <TooltipContent side="right">
            Доступно на {tierLabel(requiredTier)}
          </TooltipContent>
        </Tooltip>
      </li>
    );
  }

  return <li>{linkNode}</li>;
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
