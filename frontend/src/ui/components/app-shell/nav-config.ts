/**
 * nav-config.ts — ЕДИНЫЙ источник правды о навигации кабинета (десктоп + мобилка).
 *
 * ТЗ 2026-06-13 «Редизайн кабинета: ритмы, очередь решений, новое меню», Ф0.
 * Архитектура §1.1 (целевая карта меню). Закрывает nav-долг
 * `second-brain/04_не-сделано:47` (раньше десктоп-сайдбар и мобильные табы
 * хардкодились раздельно и расходились).
 *
 * Новая модель — 3 ритма + рабочие разделы + Я + Система, роль-зависимо:
 *
 *   owner / admin   coo                     manager (рядовой)
 *   ─────────────   ───────────────────     ──────────────────────
 *   ▸ РИТМЫ         ▸ РИТМЫ                  ▸ МОЁ
 *     Сегодня         Сегодня                  Сегодня   = /me
 *     Неделя          Неделя                   Мои дела  = /me/inbox
 *     Итоги месяца    (без месяца)             Чек-ин    = /me/check-ins
 *   ▸ РАБОТА        ▸ РАБОТА                 ▸ РАБОТА
 *     Встречи         Встречи                  Встречи
 *     Задачи          Задачи                   Задачи
 *     Память          Память                   Спросить  = /chat
 *     Команда         Команда                  Память (read)
 *   ▸ ЛИЧНОЕ
 *     Я
 *   ▸ СИСТЕМА (свёрнуто)
 *     Настройки · Справочник (аккордеон) · Админка · Суперадмин
 *
 * ВАЖНО: этот модуль — чистый (без JSX/хуков). Иконки — это компоненты-значения
 * lucide, их можно импортировать и в pure-`.ts` (как делает `mobile-tabs.ts`).
 * Динамические данные (живые счётчики бейджей, точка «новое», фильтр доступа к
 * памяти, статус support-деска, super_admin) разрешаются в рантайме: конфиг лишь
 * ПОМЕЧАЕТ пункт (`badge`/`dot`/`access`/`requires*`), а `Sidebar.tsx`
 * подставляет значения из хуков.
 */

import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookText,
  Bot,
  Brain,
  Building2,
  CalendarClock,
  CalendarRange,
  CheckCircle2,
  ClipboardList,
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
  Network,
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
} from 'lucide-react';

import type { FeatureKey } from '@/domain/entitlement';
import type { CurrentOrgRole } from '@/domain/account';
import { SECTION_LABELS } from '@/lib/section-labels';

/**
 * Роли навигации. `null` (нет роли) трактуется как `manager` (минимальный
 * доступ). Заметка: «рядовой» в продуктовых терминах = роль `manager`.
 */
export type NavRole = 'owner' | 'admin' | 'coo' | 'manager';

/** Лидеры компании — видят ритмы и сводки по всем. */
export const LEADERSHIP_ROLES: readonly NavRole[] = ['owner', 'admin', 'coo'];
/** Полный доступ (владелец/админ) — видят «Итоги месяца» и Админку. */
export const OWNER_ADMIN_ROLES: readonly NavRole[] = ['owner', 'admin'];

export interface NavConfigItem {
  href: string;
  label: string;
  icon: LucideIcon;
  matchPrefix?: string;
  /** Роли, которым виден пункт. `undefined` = всем авторизованным. */
  roles?: readonly NavRole[];
  /** Тариф-гейт (на закрытом тарифе пункт виден, но с замком — см. Sidebar). */
  gateFeature?: FeatureKey;
  comingSoon?: boolean;
  tourTarget?: string;
  overviewTarget?: string;
  /** Живой бейдж: Sidebar подставит счётчик из соответствующего хука. */
  badge?: 'myInbox';
  /** Точка «новое»: Sidebar подставит из хука. */
  dot?: 'cloneGrants';
  /** Доп. фильтр доступа к памяти (useMemoryAccess) — гейтит только manager. */
  access?: 'regulations' | 'entities';
  /** Виден только когда support-деск настроен (useSupportStatus().deskEnabled). */
  requiresDesk?: boolean;
  /** Виден только сотруднику поддержки (useSupportStatus().isAgent). */
  requiresSupportAgent?: boolean;
  /** Виден только super_admin. */
  requiresSuperAdmin?: boolean;
}

export interface NavConfigSubgroup {
  label: string;
  /** Персист состояния collapse в localStorage по этому ключу. */
  storageKey?: string;
  defaultCollapsed: boolean;
  items: NavConfigItem[];
}

export interface NavConfigSection {
  id: string;
  label: string;
  /** Роли, которым видна вся секция. `undefined` = всем. */
  roles?: readonly NavRole[];
  hideLabel?: boolean;
  items: NavConfigItem[];
  collapsibleSubgroups?: NavConfigSubgroup[];
}

// ───────────────────────────── РИТМЫ ─────────────────────────────
// owner/admin/coo: Сегодня · Неделя · Итоги месяца (месяц — только owner/admin).

const RHYTHMS_SECTION: NavConfigSection = {
  id: 'rhythms',
  label: 'Ритмы',
  roles: LEADERSHIP_ROLES,
  items: [
    {
      href: '/dashboard',
      label: 'Сегодня',
      icon: Home,
      matchPrefix: '/dashboard',
      tourTarget: 'welcome.sidebar-home',
      overviewTarget: 'overview.dashboard',
    },
    {
      href: '/week',
      label: 'Неделя',
      icon: CalendarRange,
      matchPrefix: '/week',
      overviewTarget: 'overview.week',
    },
    {
      href: '/month',
      label: 'Итоги месяца',
      icon: TrendingUp,
      matchPrefix: '/month',
      roles: OWNER_ADMIN_ROLES,
      overviewTarget: 'overview.month',
    },
  ],
};

// ───────────────────────────── МОЁ (manager) ─────────────────────
// Рядовой: домашний «Сегодня» = /me, плюс Мои дела и Чек-ин.

const MY_SECTION: NavConfigSection = {
  id: 'my',
  label: 'Моё',
  roles: ['manager'],
  items: [
    {
      href: '/me',
      label: 'Сегодня',
      icon: UserRound,
      matchPrefix: '/me',
      overviewTarget: 'overview.me',
    },
    {
      href: '/me/inbox',
      label: 'Мои дела',
      icon: Inbox,
      matchPrefix: '/me/inbox',
      badge: 'myInbox',
    },
    {
      href: '/me/check-ins',
      label: 'Чек-ин',
      icon: CheckCircle2,
      matchPrefix: '/me/check-ins',
    },
  ],
};

// ───────────────────────────── РАБОТА ────────────────────────────
// Лидеры: Встречи · Задачи · Память · Команда.
// Рядовой:  Встречи · Задачи · Спросить · Память (read).

const WORK_SECTION: NavConfigSection = {
  id: 'work',
  label: 'Работа',
  items: [
    {
      href: '/meetings',
      label: 'Встречи',
      icon: Video,
      matchPrefix: '/meetings',
      tourTarget: 'welcome.sidebar-meetings',
      overviewTarget: 'overview.meetings',
    },
    {
      href: '/projects',
      label: 'Задачи',
      icon: ListChecks,
      matchPrefix: '/projects',
      tourTarget: 'welcome.sidebar-projects',
      overviewTarget: 'overview.projects',
    },
    // Рядовой: «Спросить» — отдельный быстрый вход в чат-помощника.
    {
      href: '/chat',
      label: 'Спросить',
      icon: MessageCircle,
      matchPrefix: '/chat',
      roles: ['manager'],
      gateFeature: 'feature.chat_org',
      overviewTarget: 'overview.chat',
    },
    {
      href: '/memory',
      label: 'Память',
      icon: Brain,
      matchPrefix: '/memory',
      overviewTarget: 'overview.memory',
    },
    // «Оцифровано» — регламенты, процессы, инструкции и политики, извлечённые из
    // встреч (страница /regulations сама гейтит доступ по RBAC).
    {
      href: '/regulations',
      label: 'Оцифровано',
      icon: BookText,
      matchPrefix: '/regulations',
    },
    {
      href: '/structure',
      label: SECTION_LABELS.structure, // «Команда»
      icon: Users,
      matchPrefix: '/structure',
      roles: LEADERSHIP_ROLES,
      tourTarget: 'welcome.structure',
      overviewTarget: 'overview.team',
    },
  ],
};

// ───────────────────────────── ЛИЧНОЕ (лидеры) ───────────────────
// У рядового «Я» = домашний «Сегодня» (МОЁ), отдельного пункта нет.

const PERSONAL_SECTION: NavConfigSection = {
  id: 'personal',
  label: 'Личное',
  roles: LEADERSHIP_ROLES,
  items: [
    {
      href: '/me',
      label: 'Я',
      icon: UserRound,
      matchPrefix: '/me',
      overviewTarget: 'overview.me',
    },
  ],
};

// ───────────────────────── ПОДДЕРЖКА (агент деска) ───────────────
const SUPPORT_SECTION: NavConfigSection = {
  id: 'support',
  label: 'Поддержка',
  items: [
    {
      href: '/support/desk',
      label: 'Поддержка',
      icon: LifeBuoy,
      matchPrefix: '/support/desk',
      requiresSupportAgent: true,
    },
  ],
};

// ───────────────────────────── СИСТЕМА ───────────────────────────
// Настройки + Справочник (аккордеон, 11 разделов) + Админка + Суперадмин.
// «Будет в следующей фазе» (Политики/Метрики) убраны из меню (Ф0); Процессы —
// реальная страница, остаётся в Справочнике.

const REFERENCE_SUBGROUP: NavConfigSubgroup = {
  label: 'Справочник',
  storageKey: 'sidebar.reference.open',
  defaultCollapsed: true,
  items: [
    { href: '/company', label: 'Компания', icon: Building2, matchPrefix: '/company', tourTarget: 'welcome.company' },
    { href: '/departments', label: 'Отделы', icon: Network, matchPrefix: '/departments', tourTarget: 'welcome.departments' },
    { href: '/domains', label: 'Домены', icon: Shapes, matchPrefix: '/domains' },
    { href: '/maturity', label: 'Зрелость', icon: Gauge, matchPrefix: '/maturity' },
    { href: '/documents', label: 'Документы', icon: FileText, matchPrefix: '/documents' },
    { href: '/roles', label: 'Карты должностей', icon: IdCard, matchPrefix: '/roles', tourTarget: 'welcome.roles' },
    { href: '/clones', label: 'Клоны', icon: Bot, matchPrefix: '/clones', dot: 'cloneGrants' },
    { href: '/vendors', label: 'Поставщики', icon: Truck, matchPrefix: '/vendors' },
    { href: '/events', label: 'События', icon: CalendarClock, matchPrefix: '/events' },
    { href: '/experiments', label: 'Эксперименты', icon: FlaskConical, matchPrefix: '/experiments' },
    { href: '/brand-voice', label: 'Голос бренда', icon: Palette, matchPrefix: '/brand-voice' },
    // «Процессы» (/processes) убраны из меню — их поглощает хаб «Оцифровано»
    // (/regulations) вкладкой «Шаблоны процессов». Сама страница остаётся живой
    // (используется хабом), просто без отдельного пункта в Справочнике.
  ],
};

const SYSTEM_SECTION: NavConfigSection = {
  id: 'system',
  label: 'Система',
  items: [
    { href: '/settings', label: 'Настройки', icon: Settings, matchPrefix: '/settings', overviewTarget: 'overview.settings' },
    // /settings/integrations = outbound-направления доставки (единственный вход;
    // дубль «Интеграции» из «Чатов» убран в Ф0).
    { href: '/settings/integrations', label: 'Интеграции', icon: Plug, matchPrefix: '/settings/integrations' },
    { href: '/team-templates', label: 'Шаблоны', icon: Shapes, matchPrefix: '/team-templates' },
    // Партнёрка — личный кабинет реферальной программы (доступен всем ролям:
    // ссылку можно создать без ИНН). Раньше входа в меню не было — только промо-полоса.
    { href: '/referrals', label: 'Партнёрка', icon: Gift, matchPrefix: '/referrals' },
    // Канал обратной связи «Ваши предложения» (форма + ночная AI-кластеризация в
    // смысловые блоки). Виден всем ролям; вернули в меню после редизайна Ф0
    // (ТЗ 2026-06-15). Тултип берётся из NAV_HELP['/feedback'].
    { href: '/feedback', label: 'Ваши предложения', icon: Lightbulb, matchPrefix: '/feedback' },
    // «Мои обращения» — личный вход в свои тикеты поддержки (когда деск настроен).
    { href: '/support/my-tickets', label: 'Мои обращения', icon: LifeBuoy, matchPrefix: '/support/my-tickets', requiresDesk: true },
  ],
  collapsibleSubgroups: [
    REFERENCE_SUBGROUP,
    {
      label: 'Админка',
      storageKey: 'sidebar.admin.open',
      defaultCollapsed: false,
      items: [
        {
          href: '/company-admin',
          label: 'Админка компании',
          icon: Settings2,
          matchPrefix: '/company-admin',
          roles: OWNER_ADMIN_ROLES,
          overviewTarget: 'overview.admin',
        },
        {
          href: '/admin',
          label: 'Суперадмин',
          icon: Shield,
          matchPrefix: '/admin',
          requiresSuperAdmin: true,
        },
      ],
    },
  ],
};

/**
 * Полное декларативное дерево десктоп-навигации (роль-агностичное — фильтрация
 * по роли применяется в `resolveDesktopNav`). Порядок секций = порядок рендера.
 */
export const DESKTOP_NAV: readonly NavConfigSection[] = [
  RHYTHMS_SECTION,
  MY_SECTION,
  WORK_SECTION,
  PERSONAL_SECTION,
  SUPPORT_SECTION,
  SYSTEM_SECTION,
];

// ─────────────────────────── Резолвер по роли ────────────────────

export interface NavResolveContext {
  role: CurrentOrgRole;
  isSuperAdmin: boolean;
  deskEnabled: boolean;
  isSupportAgent: boolean;
}

/** `null`-роль → `manager` (минимальный доступ). */
export function normalizeRole(role: CurrentOrgRole): NavRole {
  return role ?? 'manager';
}

function itemVisible(item: NavConfigItem, ctx: NavResolveContext): boolean {
  const role = normalizeRole(ctx.role);
  if (item.roles && !item.roles.includes(role)) return false;
  if (item.requiresSuperAdmin && !ctx.isSuperAdmin) return false;
  if (item.requiresDesk && !ctx.deskEnabled) return false;
  if (item.requiresSupportAgent && !ctx.isSupportAgent) return false;
  return true;
}

/**
 * Резолвит дерево навигации под конкретного пользователя: фильтрует пункты и
 * подгруппы по роли/доступу/деску/super_admin и выбрасывает пустые секции и
 * подгруппы. Бейджи/точки/access-фильтр памяти Sidebar накладывает поверх.
 */
export function resolveDesktopNav(ctx: NavResolveContext): NavConfigSection[] {
  const sections: NavConfigSection[] = [];
  for (const section of DESKTOP_NAV) {
    const role = normalizeRole(ctx.role);
    if (section.roles && !section.roles.includes(role)) continue;

    const items = section.items.filter((it) => itemVisible(it, ctx));
    const subgroups = (section.collapsibleSubgroups ?? [])
      .map((sg) => ({ ...sg, items: sg.items.filter((it) => itemVisible(it, ctx)) }))
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

// ──────────────────── Плоский союз / достижимость ────────────────
// Роль-агностичный союз всех href десктопа — для гард-теста «mobile ⊆ desktop»
// (`nav-subset.spec.ts`) и проверки достижимости. /actions добавлен явно: это
// реальная цель из топ-бара «Требует вас» (в сайдбар-секции его нет, но он
// достижим из кабинета).

export interface DesktopNavRef {
  href: string;
  matchPrefix: string;
}

function sectionRefs(section: NavConfigSection): DesktopNavRef[] {
  const all: NavConfigItem[] = [
    ...section.items,
    ...(section.collapsibleSubgroups?.flatMap((s) => s.items) ?? []),
  ];
  return all.map((it) => ({ href: it.href, matchPrefix: it.matchPrefix ?? it.href }));
}

/** Полный союз десктоп-навигации (без дублей по href). */
export function getDesktopNavRefs(): DesktopNavRef[] {
  const refs: DesktopNavRef[] = [
    ...DESKTOP_NAV.flatMap(sectionRefs),
    // Топ-бар «Требует вас» (очередь решений) — достижимая цель кабинета.
    { href: '/actions', matchPrefix: '/actions' },
  ];
  const seen = new Set<string>();
  return refs.filter((r) => {
    if (seen.has(r.href)) return false;
    seen.add(r.href);
    return true;
  });
}

/** Все href десктоп-навигации (роль-агностично). */
export const DESKTOP_NAV_HREFS: string[] = getDesktopNavRefs().map((r) => r.href);

/**
 * Достижим ли `href` через десктоп-навигацию: точное совпадение href ИЛИ
 * покрытие каким-либо matchPrefix (`/me` покрывает `/me/inbox`).
 */
export function isDesktopNavReachable(href: string): boolean {
  return getDesktopNavRefs().some(
    (r) => href === r.href || href === r.matchPrefix || href.startsWith(`${r.matchPrefix}/`),
  );
}

// ─────────────────────────── Мобильные табы ──────────────────────
// ТЗ Ф9. Единый источник: те же href, что и в десктопе (гард mobile ⊆ desktop).
//   EXEC (owner/admin):  Сегодня /dashboard · Неделя /week · Требует вас /actions
//                        · Память /memory · Я /me
//   MANAGER (остальные): Сегодня /me · Чек-ин /me/check-ins · Спросить /chat
//                        · Дела /me/inbox
// Паритет «Память» (A11.2): таб EXEC «Память» ведёт на /memory — тот же URL и
// смысл, что у десктоп-пункта «Память» (виден EXEC). Раньше вёл на /chat
// («Спросить»), который у EXEC на десктопе скрыт (roles: ['manager']) — это
// рассинхрон label↔URL и доступ к разделу вне десктоп-меню EXEC.

export interface MobileNavTab {
  key: string;
  href: string;
  label: string;
  icon: LucideIcon;
}

export const MOBILE_EXEC_TABS: readonly MobileNavTab[] = [
  { key: 'today', href: '/dashboard', label: 'Сегодня', icon: Home },
  { key: 'week', href: '/week', label: 'Неделя', icon: CalendarRange },
  { key: 'requires', href: '/actions', label: 'Требует вас', icon: AlertTriangle },
  { key: 'memory', href: '/memory', label: 'Память', icon: Brain },
  { key: 'me', href: '/me', label: 'Я', icon: UserRound },
] as const;

export const MOBILE_MANAGER_TABS: readonly MobileNavTab[] = [
  { key: 'today', href: '/me', label: 'Сегодня', icon: UserRound },
  { key: 'checkin', href: '/me/check-ins', label: 'Чек-ин', icon: CheckCircle2 },
  { key: 'ask', href: '/chat', label: 'Спросить', icon: MessageCircle },
  { key: 'deals', href: '/me/inbox', label: 'Дела', icon: Inbox },
] as const;
