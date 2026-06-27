import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookText,
  Brain,
  Building2,
  CalendarClock,
  CalendarRange,
  CheckCircle2,
  ClipboardList,
  Contact,
  FileText,
  FlaskConical,
  Gauge,
  Gift,
  Home,
  IdCard,
  Inbox,
  LifeBuoy,
  Lightbulb,
  ListChecks,
  MessageCircle,
  Palette,
  Plug,
  Settings,
  Settings2,
  Shapes,
  Shield,
  Sparkles,
  Table2,
  Target,
  TrendingUp,
  Truck,
  UserRound,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";

import type { FeatureKey } from "@/domain/entitlement";
import type { CurrentOrgRole } from "@/domain/account";
import { SECTION_LABELS } from "@/lib/section-labels";

export type NavRole = "owner" | "admin" | "coo" | "manager";

export const LEADERSHIP_ROLES: readonly NavRole[] = ["owner", "admin", "coo"];
export const OWNER_ADMIN_ROLES: readonly NavRole[] = ["owner", "admin"];

export interface NavConfigItem {
  href: string;
  label: string;
  icon: LucideIcon;
  matchPrefix?: string;
  roles?: readonly NavRole[];
  gateFeature?: FeatureKey;
  comingSoon?: boolean;
  tourTarget?: string;
  overviewTarget?: string;
  badge?: "myInbox";
  dot?: "cloneGrants";
  access?: "regulations" | "entities";
  requiresDesk?: boolean;
  requiresSupportAgent?: boolean;
  requiresSuperAdmin?: boolean;
}

export interface NavConfigSubgroup {
  label: string;
  storageKey?: string;
  defaultCollapsed: boolean;
  items: NavConfigItem[];
}

export interface NavConfigSection {
  id: string;
  label: string;
  roles?: readonly NavRole[];
  hideLabel?: boolean;
  items: NavConfigItem[];
  collapsibleSubgroups?: NavConfigSubgroup[];
}

const RHYTHMS_SECTION: NavConfigSection = {
  id: "rhythms",
  label: "Ритмы",
  roles: LEADERSHIP_ROLES,
  items: [
    {
      href: "/dashboard",
      label: "Сегодня",
      icon: Home,
      matchPrefix: "/dashboard",
      tourTarget: "welcome.sidebar-home",
      overviewTarget: "overview.dashboard",
    },
    {
      href: "/dashboard/operations",
      label: "Аналитика",
      icon: BarChart3,
      matchPrefix: "/dashboard/operations",
      overviewTarget: "overview.operations",
    },
    {
      href: "/week",
      label: "Неделя",
      icon: CalendarRange,
      matchPrefix: "/week",
      overviewTarget: "overview.week",
    },
    {
      href: "/month",
      label: "Итоги месяца",
      icon: TrendingUp,
      matchPrefix: "/month",
      roles: OWNER_ADMIN_ROLES,
      overviewTarget: "overview.month",
    },
  ],
};

const MY_SECTION: NavConfigSection = {
  id: "my",
  label: "Моё",
  roles: ["manager"],
  items: [
    {
      href: "/me",
      label: "Сегодня",
      icon: UserRound,
      matchPrefix: "/me",
      overviewTarget: "overview.me",
    },
    {
      href: "/me/inbox",
      label: "Мои дела",
      icon: Inbox,
      matchPrefix: "/me/inbox",
      badge: "myInbox",
    },
    {
      href: "/actions",
      label: "Требует вас",
      icon: AlertTriangle,
      matchPrefix: "/actions",
    },
    {
      href: "/me/check-ins",
      label: "Чек-ин",
      icon: CheckCircle2,
      matchPrefix: "/me/check-ins",
    },
  ],
};

const WORK_SECTION: NavConfigSection = {
  id: "work",
  label: "Работа",
  items: [
    {
      href: "/meetings",
      label: "Встречи",
      icon: Video,
      matchPrefix: "/meetings",
      tourTarget: "welcome.sidebar-meetings",
      overviewTarget: "overview.meetings",
    },
    {
      href: "/projects",
      label: "Задачи",
      icon: ListChecks,
      matchPrefix: "/projects",
      tourTarget: "welcome.sidebar-projects",
      overviewTarget: "overview.projects",
    },
    {
      href: "/chat",
      label: "Спросить",
      icon: MessageCircle,
      matchPrefix: "/chat",
      gateFeature: "feature.chat_org",
      overviewTarget: "overview.chat",
    },
    {
      href: "/memory",
      label: "Память",
      icon: Brain,
      matchPrefix: "/memory",
      overviewTarget: "overview.memory",
    },
    {
      href: "/regulations",
      label: "База знаний",
      icon: BookText,
      matchPrefix: "/regulations",
    },
    {
      href: "/goals",
      label: "Цели",
      icon: Target,
      matchPrefix: "/goals",
      roles: LEADERSHIP_ROLES,
      gateFeature: "feature.goals_strategy",
    },
    {
      href: "/structure",
      label: SECTION_LABELS.structure,
      icon: Users,
      matchPrefix: "/structure",
      roles: LEADERSHIP_ROLES,
      tourTarget: "welcome.structure",
      overviewTarget: "overview.team",
    },
  ],
};

const PERSONAL_SECTION: NavConfigSection = {
  id: "personal",
  label: "Личное",
  roles: LEADERSHIP_ROLES,
  items: [
    {
      href: "/me",
      label: "Я",
      icon: UserRound,
      matchPrefix: "/me",
      overviewTarget: "overview.me",
    },
    {
      href: "/actions",
      label: "Требует вас",
      icon: AlertTriangle,
      matchPrefix: "/actions",
    },
  ],
};

const SUPPORT_SECTION: NavConfigSection = {
  id: "support",
  label: "Поддержка",
  items: [
    {
      href: "/support/desk",
      label: "Поддержка",
      icon: LifeBuoy,
      matchPrefix: "/support/desk",
      requiresSupportAgent: true,
    },
  ],
};

const REFERENCE_SUBGROUP: NavConfigSubgroup = {
  label: "Справочник",
  storageKey: "sidebar.reference.open",
  defaultCollapsed: true,
  items: [
    {
      href: "/company",
      label: "Компания",
      icon: Building2,
      matchPrefix: "/company",
      tourTarget: "welcome.company",
    },
    {
      href: "/maturity",
      label: "Зрелость",
      icon: Gauge,
      matchPrefix: "/maturity",
    },
    {
      href: "/documents",
      label: "Документы",
      icon: FileText,
      matchPrefix: "/documents",
    },
    {
      href: "/roles",
      label: "Должности",
      icon: IdCard,
      matchPrefix: "/roles",
      tourTarget: "welcome.roles",
      dot: "cloneGrants",
    },
    {
      href: "/vendors",
      label: "Поставщики",
      icon: Truck,
      matchPrefix: "/vendors",
    },
    {
      href: "/customers",
      label: "Клиенты",
      icon: Contact,
      matchPrefix: "/customers",
    },
    {
      href: "/events",
      label: "События",
      icon: CalendarClock,
      matchPrefix: "/events",
    },
    {
      href: "/experiments",
      label: "Эксперименты",
      icon: FlaskConical,
      matchPrefix: "/experiments",
    },
    {
      href: "/brand-voice",
      label: "Голос бренда",
      icon: Palette,
      matchPrefix: "/brand-voice",
    },
  ],
};

const SYSTEM_SECTION: NavConfigSection = {
  id: "system",
  label: "Система",
  items: [
    {
      href: "/settings",
      label: "Настройки",
      icon: Settings,
      matchPrefix: "/settings",
      overviewTarget: "overview.settings",
    },
    {
      href: "/delivery",
      label: "Доставка",
      icon: Plug,
      matchPrefix: "/delivery",
    },
    {
      href: "/referrals",
      label: "Партнёрка",
      icon: Gift,
      matchPrefix: "/referrals",
    },
    {
      href: "/feedback",
      label: "Ваши предложения",
      icon: Lightbulb,
      matchPrefix: "/feedback",
    },
    {
      href: "/support/my-tickets",
      label: "Мои обращения",
      icon: LifeBuoy,
      matchPrefix: "/support/my-tickets",
      requiresDesk: true,
    },
  ],
  collapsibleSubgroups: [
    REFERENCE_SUBGROUP,
    {
      label: "Системное",
      storageKey: "sidebar.system-advanced.open",
      defaultCollapsed: true,
      items: [
        {
          href: "/domains",
          label: "Домены",
          icon: Shapes,
          matchPrefix: "/domains",
        },
      ],
    },
    {
      label: "Админка",
      storageKey: "sidebar.admin.open",
      defaultCollapsed: false,
      items: [
        {
          href: "/company-admin",
          label: "Админка компании",
          icon: Settings2,
          matchPrefix: "/company-admin",
          roles: OWNER_ADMIN_ROLES,
          overviewTarget: "overview.admin",
        },
        {
          href: "/admin",
          label: "Суперадмин",
          icon: Shield,
          matchPrefix: "/admin",
          requiresSuperAdmin: true,
        },
      ],
    },
  ],
};

export const DESKTOP_NAV: readonly NavConfigSection[] = [
  RHYTHMS_SECTION,
  MY_SECTION,
  WORK_SECTION,
  PERSONAL_SECTION,
  SUPPORT_SECTION,
  SYSTEM_SECTION,
];

export interface NavResolveContext {
  role: CurrentOrgRole;
  isSuperAdmin: boolean;
  deskEnabled: boolean;
  isSupportAgent: boolean;
}

export function normalizeRole(role: CurrentOrgRole): NavRole {
  return role ?? "manager";
}

function itemVisible(item: NavConfigItem, ctx: NavResolveContext): boolean {
  const role = normalizeRole(ctx.role);
  if (item.roles && !item.roles.includes(role)) return false;
  if (item.requiresSuperAdmin && !ctx.isSuperAdmin) return false;
  if (item.requiresDesk && !ctx.deskEnabled) return false;
  if (item.requiresSupportAgent && !ctx.isSupportAgent) return false;
  return true;
}

export function resolveDesktopNav(ctx: NavResolveContext): NavConfigSection[] {
  const sections: NavConfigSection[] = [];
  for (const section of DESKTOP_NAV) {
    const role = normalizeRole(ctx.role);
    if (section.roles && !section.roles.includes(role)) continue;

    const items = section.items.filter((it) => itemVisible(it, ctx));
    const subgroups = (section.collapsibleSubgroups ?? [])
      .map((sg) => ({
        ...sg,
        items: sg.items.filter((it) => itemVisible(it, ctx)),
      }))
      .filter((sg) => sg.items.length > 0);

    if (items.length === 0 && subgroups.length === 0) continue;

    sections.push({
      ...section,
      items,
      ...(subgroups.length ? { collapsibleSubgroups: subgroups } : {}),
    });
  }
  return sections;
}

export interface DesktopNavRef {
  href: string;
  matchPrefix: string;
}

function sectionRefs(section: NavConfigSection): DesktopNavRef[] {
  const all: NavConfigItem[] = [
    ...section.items,
    ...(section.collapsibleSubgroups?.flatMap((s) => s.items) ?? []),
  ];
  return all.map((it) => ({
    href: it.href,
    matchPrefix: it.matchPrefix ?? it.href,
  }));
}

export function getDesktopNavRefs(): DesktopNavRef[] {
  const refs: DesktopNavRef[] = [...DESKTOP_NAV.flatMap(sectionRefs)];
  const seen = new Set<string>();
  return refs.filter((r) => {
    if (seen.has(r.href)) return false;
    seen.add(r.href);
    return true;
  });
}

export const DESKTOP_NAV_HREFS: string[] = getDesktopNavRefs().map(
  (r) => r.href,
);

export function isDesktopNavReachable(href: string): boolean {
  return getDesktopNavRefs().some(
    (r) =>
      href === r.href ||
      href === r.matchPrefix ||
      href.startsWith(`${r.matchPrefix}/`),
  );
}

export interface MobileNavTab {
  key: string;
  href: string;
  label: string;
  icon: LucideIcon;
}

export const MOBILE_EXEC_TABS: readonly MobileNavTab[] = [
  { key: "today", href: "/dashboard", label: "Сегодня", icon: Home },
  { key: "week", href: "/week", label: "Неделя", icon: CalendarRange },
  {
    key: "requires",
    href: "/actions",
    label: "Требует вас",
    icon: AlertTriangle,
  },
  { key: "memory", href: "/memory", label: "Память", icon: Brain },
  { key: "me", href: "/me", label: "Я", icon: UserRound },
] as const;

export const MOBILE_MANAGER_TABS: readonly MobileNavTab[] = [
  { key: "today", href: "/me", label: "Сегодня", icon: UserRound },
  {
    key: "checkin",
    href: "/me/check-ins",
    label: "Чек-ин",
    icon: CheckCircle2,
  },
  { key: "ask", href: "/chat", label: "Спросить", icon: MessageCircle },
  { key: "deals", href: "/me/inbox", label: "Дела", icon: Inbox },
] as const;
