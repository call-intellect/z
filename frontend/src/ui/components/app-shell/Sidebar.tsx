"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Brain,
  ChevronDown,
  ChevronRight,
  Clock4,
  KeyRound,
  ListChecks,
  Lock,
  LogOut,
  Plus,
  Target,
  User,
  Video,
  type LucideIcon,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/ui/shadcn/avatar";
import { Button } from "@/ui/shadcn/button";
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
} from "@/ui/shadcn/dropdown-menu";
import { Separator } from "@/ui/shadcn/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/ui/shadcn/tooltip";
import { cn } from "@/ui/shadcn/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { useEntitlement } from "@/hooks/useEntitlement";
import { useMyInboxCount } from "@/hooks/tracker/useMyInboxCount";
import { useUnreadMessageCount } from "@/hooks/messaging/useUnreadMessageCount";
import { useSupportStatus } from "@/hooks/useSupportStatus";
import { useUnseenCloneGrants } from "@/hooks/useUnseenCloneGrants";
import { FEATURE_MIN_TIER, tierLabel } from "@/domain/entitlement";
import { useTheme } from "@/ui/components/theme/ThemeProvider";
import { NAV_HELP } from "@/lib/nav-help";
import { OrgSwitcher } from "./OrgSwitcher";
import {
  resolveDesktopNav,
  type NavConfigItem,
  type NavConfigSection,
  type NavConfigSubgroup,
} from "./nav-config";

type ResolvedNavItem = NavConfigItem & {
  badgeCount?: number;
  showDot?: boolean;
};

export function Sidebar({
  className,
  onNavigate,
}: {
  className?: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname() ?? "";
  const { isSuperAdmin, currentOrgRole, currentOrgId } = useAuth();

  const { count: myInboxCount } = useMyInboxCount(currentOrgId);

  const { total: unreadMessagesCount } = useUnreadMessageCount(currentOrgId);

  const hasUnseenCloneGrants = useUnseenCloneGrants(currentOrgId);

  const support = useSupportStatus();

  const sections = resolveDesktopNav({
    role: currentOrgRole,
    isSuperAdmin,
    deskEnabled: support.deskEnabled,
    isSupportAgent: support.isAgent,
  });

  const overlay = (item: NavConfigItem): ResolvedNavItem => {
    const out: ResolvedNavItem = { ...item };
    if (item.badge === "myInbox") out.badgeCount = myInboxCount;
    if (item.badge === "unreadMessages") out.badgeCount = unreadMessagesCount;
    if (item.dot === "cloneGrants") out.showDot = hasUnseenCloneGrants;
    return out;
  };

  const resolvedSections = sections.map((section) => ({
    ...section,
    items: section.items.map(overlay),
    ...(section.collapsibleSubgroups
      ? {
          collapsibleSubgroups: section.collapsibleSubgroups.map((sg) => ({
            ...sg,
            items: sg.items.map(overlay),
          })),
        }
      : {}),
  }));

  const allItems: ResolvedNavItem[] = resolvedSections.flatMap((g) => [
    ...g.items,
    ...(g.collapsibleSubgroups?.flatMap((s) => s.items) ?? []),
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
        "flex h-full w-sb shrink-0 flex-col border-r border-border-subtle bg-bg-surface",
        className,
      )}
    >
      {}
      <div className="flex h-header items-center px-5">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="flex items-center gap-2"
          aria-label="На главную"
          data-tour-target="welcome.sidebar-logo"
          data-overview-target="overview.logo"
        >
          <div className="grid h-7 w-7 place-items-center rounded-md bg-accent font-mono text-sm font-bold text-accent-fg">
            К
          </div>
          <span className="text-lg font-semibold tracking-tight text-fg-primary">
            Кора
          </span>
        </Link>
      </div>

      {}
      <div className="px-3 pb-2" data-overview-target="overview.org-switcher">
        <OrgSwitcher variant="sidebar" />
      </div>

      {}
      <div
        className="px-3 pb-3"
        data-tour-target="welcome.create-meeting"
        data-overview-target="overview.create"
      >
        <CreateMenu onNavigate={onNavigate} />
      </div>

      <Separator />

      {}
      <nav className="flex-1 overflow-y-auto p-2">
        <TooltipProvider delayDuration={150}>
          {resolvedSections.map((section, idx) => (
            <SidebarGroup
              key={section.id}
              group={section}
              winnerHref={winnerHref}
              onNavigate={onNavigate}
              showSeparator={idx > 0}
            />
          ))}
        </TooltipProvider>
      </nav>

      <Separator />

      {}
      <div className="p-2">
        <UserCard onAfterAction={onNavigate} />
      </div>
    </aside>
  );
}

function CreateMenu({ onNavigate }: { onNavigate?: () => void }) {
  const opts: { href: string; label: string; icon: LucideIcon }[] = [
    { href: "/meetings/create", label: "Встреча", icon: Video },
    { href: "/dump", label: "Мысль", icon: Brain },
    { href: "/intake", label: "Задача", icon: ListChecks },
    { href: "/goals", label: "Цель", icon: Target },
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="w-full justify-start gap-2" size="default">
          <Plus size={16} strokeWidth={2.2} />
          Создать
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[calc(var(--sidebar-w)-1.5rem)] min-w-44"
      >
        {opts.map((o) => {
          const Icon = o.icon;
          return (
            <DropdownMenuItem key={o.href} asChild>
              <Link
                href={o.href}
                onClick={onNavigate}
                className="flex items-center gap-2"
              >
                <Icon size={15} strokeWidth={1.75} />
                {o.label}
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SidebarGroup({
  group,
  winnerHref,
  onNavigate,
  showSeparator,
}: {
  group: NavConfigSection & { items: ResolvedNavItem[] };
  winnerHref: string | null;
  onNavigate?: () => void;
  showSeparator: boolean;
}) {
  return (
    <div>
      {showSeparator && <Separator className="my-2" />}
      {!group.hideLabel && (
        <div className="mt-4 mb-1.5 px-3 text-xs font-semibold uppercase tracking-wider text-fg-secondary">
          {group.label}
        </div>
      )}
      {group.items.length > 0 && (
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
      )}
      {group.collapsibleSubgroups?.map((sg) => (
        <SidebarSubgroup
          key={sg.label}
          subgroup={sg as NavConfigSubgroup & { items: ResolvedNavItem[] }}
          winnerHref={winnerHref}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}

function SidebarSubgroup({
  subgroup,
  winnerHref,
  onNavigate,
}: {
  subgroup: NavConfigSubgroup & { items: ResolvedNavItem[] };
  winnerHref: string | null;
  onNavigate?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(subgroup.defaultCollapsed);

  useEffect(() => {
    if (!subgroup.storageKey) return;
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(subgroup.storageKey);
      if (stored === "0") setCollapsed(false);
      else if (stored === "1") setCollapsed(true);
    } catch {}
  }, [subgroup.storageKey]);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      if (subgroup.storageKey && typeof window !== "undefined") {
        try {
          window.localStorage.setItem(subgroup.storageKey, next ? "1" : "0");
        } catch {}
      }
      return next;
    });
  };

  const hasActive = subgroup.items.some((i) => i.href === winnerHref);
  const effectiveCollapsed = hasActive ? false : collapsed;

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={toggle}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs uppercase tracking-wider text-fg-tertiary transition-colors",
          "hover:bg-bg-overlay hover:text-fg-secondary",
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

function SidebarNavLink({
  item,
  isActive,
  onNavigate,
}: {
  item: ResolvedNavItem;
  isActive: boolean;
  onNavigate?: () => void;
}) {
  const gate = useEntitlement(item.gateFeature ?? "feature.meeting");
  const Icon = item.icon;
  const isComingSoon = item.comingSoon === true;
  const gateActive = item.gateFeature !== undefined && !isComingSoon;
  const locked = gateActive && !gate.loading && !gate.enabled;

  const baseClass =
    "relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors";

  let stateClass: string;
  if (isActive) {
    stateClass =
      "bg-accent-muted font-medium text-accent-fg dark:shadow-accent-focus";
  } else if (isComingSoon) {
    stateClass =
      "text-fg-tertiary opacity-60 hover:bg-bg-overlay/60 hover:text-fg-secondary hover:opacity-100";
  } else if (locked) {
    stateClass =
      "text-fg-tertiary hover:bg-bg-overlay/60 hover:text-fg-secondary";
  } else {
    stateClass = "text-fg-secondary hover:bg-bg-overlay hover:text-fg-primary";
  }

  const iconClass = cn(
    "shrink-0",
    isActive
      ? "text-accent"
      : isComingSoon || locked
        ? "text-fg-tertiary/70"
        : undefined,
  );

  const href = isComingSoon
    ? item.href
    : locked
      ? "/settings/billing"
      : item.href;

  const requiredTier =
    !isComingSoon && item.gateFeature
      ? (FEATURE_MIN_TIER[item.gateFeature] ?? "tier_pro")
      : null;

  const badge =
    item.badgeCount !== undefined && item.badgeCount > 0
      ? item.badgeCount > 99
        ? "99+"
        : String(item.badgeCount)
      : null;

  const linkContent = (
    <>
      {isActive && (
        <span
          aria-hidden
          className="pointer-events-none absolute left-0 top-1/2 h-1.5 w-1.5 -translate-x-1 -translate-y-1/2 rounded-full bg-accent"
        />
      )}
      <Icon size={16} strokeWidth={1.75} className={iconClass} />
      <span className="flex-1 truncate">{item.label}</span>
      {badge && (
        <span
          className={cn(
            "inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none",
            "bg-accent text-accent-fg",
          )}
          aria-label={`Непрочитанных: ${item.badgeCount}`}
        >
          {badge}
        </span>
      )}
      {!badge && item.showDot && (
        <span
          aria-label="Новое"
          className="inline-block h-2 w-2 shrink-0 rounded-full bg-accent"
        />
      )}
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
      {...(item.tourTarget ? { "data-tour-target": item.tourTarget } : {})}
      {...(item.overviewTarget
        ? { "data-overview-target": item.overviewTarget }
        : {})}
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

  const navHelp = NAV_HELP[item.href];
  if (navHelp) {
    return (
      <li>
        <Tooltip>
          <TooltipTrigger asChild>{linkNode}</TooltipTrigger>
          <TooltipContent side="right" className="max-w-56">
            <p className="font-semibold">{navHelp.title}</p>
            <p className="mt-0.5 text-xs opacity-85">{navHelp.body}</p>
          </TooltipContent>
        </Tooltip>
      </li>
    );
  }

  return <li>{linkNode}</li>;
}

const THEME_LABEL: Record<"dark" | "light" | "system", string> = {
  dark: "Тёмная",
  light: "Светлая",
  system: "Системная",
};

function UserCard({ onAfterAction }: { onAfterAction?: () => void }) {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const router = useRouter();

  const handleLogout = async () => {
    await logout();
    onAfterAction?.();
    router.push("/login");
  };

  const initials = user?.name
    ? user.name
        .split(" ")
        .map((p) => p[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : (user?.email?.slice(0, 2).toUpperCase() ?? "?");

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
              {user?.name ?? "Гость"}
            </div>
            <div className="truncate text-xs text-fg-tertiary">
              {user?.email ?? "—"}
            </div>
          </div>
          <ChevronDown size={14} className="shrink-0 text-fg-tertiary" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-56">
        <DropdownMenuLabel>Аккаунт</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link
            href="/settings"
            onClick={onAfterAction}
            className="flex items-center gap-2"
          >
            <User size={14} />
            Профиль
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link
            href="/settings?tab=security"
            onClick={onAfterAction}
            className="flex items-center gap-2"
          >
            <KeyRound size={14} />
            Сменить пароль
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            Тема
            <span className="ml-auto pr-1 text-xs text-fg-tertiary">
              {THEME_LABEL[theme]}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={() => setTheme("dark")}>
              Тёмная
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setTheme("light")}>
              Светлая
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setTheme("system")}>
              Системная
            </DropdownMenuItem>
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
