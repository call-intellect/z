'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  Brain,
  Building2,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock4,
  FileText,
  FlaskConical,
  FolderKanban,
  Gauge,
  HeartHandshake,
  Home,
  IdCard,
  Inbox,
  Lightbulb,
  ListChecks,
  Lock,
  LogOut,
  MessageCircle,
  Network,
  Newspaper,
  Palette,
  Plug,
  Plus,
  Rocket,
  Scale,
  Settings,
  Settings2,
  Shapes,
  Shield,
  Sparkles,
  Target,
  Truck,
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
import { useIntakePendingCount } from '@/hooks/tracker/useIntakePendingCount';
import { useMemoryAccess } from '@/hooks/useMemoryAccess';
// ТЗ 2026-05-26 §5.5 — точка-индикатор «новый грант на клона».
import { useUnseenCloneGrants } from '@/hooks/useUnseenCloneGrants';
import {
  FEATURE_MIN_TIER,
  tierLabel,
  type FeatureKey,
} from '@/domain/entitlement';
import { useTheme } from '@/ui/components/theme/ThemeProvider';
import { OrgSwitcher } from './OrgSwitcher';

/**
 * Sidebar — главный навигационный каркас ЛК.
 *
 * Структура (ТЗ 2026-05-27 navigation-restructure) — 6 смысловых слоёв
 * вместо плоских 3 групп, отражающих частоту использования и природу
 * данных:
 *   1. «Каждый день» — daily drivers: главная, встречи, дамп, карточки,
 *      проекты, помощник. Для owner/admin сюда же добавляется «Входящие»
 *      с живым бейджем (useIntakePendingCount).
 *   2. «Моё пространство» — личный кабинет: /me и его подразделы, фидбек.
 *   3. «Память компании» — knowledge-граф: идеи, правила, решения,
 *      сигналы, сущности, темы. Доступ фильтруется через
 *      `useMemoryAccess()` (роль + entitlement-флаги).
 *   4. «Управление» — ролевые дашборды (COO-панель, отчёты, цели). Целая
 *      группа условная: рендерится только для owner / admin / coo.
 *   5. «Справочник» — структура и метаданные компании (структура, отделы,
 *      домены, документы, карты должностей, клоны, поставщики, события,
 *      эксперименты, голос бренда). Целая группа collapsible, по умолчанию
 *      свёрнута; внутри — вторая подгруппа «Будет в следующей фазе» с
 *      γ-пунктами (Процессы / Политики / Метрики).
 *   6. «Настройки» — конфиг + админка (последняя видна только owner/admin).
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
  /**
   * Phase 3 Sprint 6: число «непрочитанных» рядом с пунктом
   * (используется в «Входящие» для admin/owner). Значение 0 или
   * undefined — бейдж скрыт. >99 показывается как «99+».
   */
  badgeCount?: number;
  /**
   * ТЗ 2026-05-26 §5.5: рисуем маленькую точку справа от подписи —
   * «есть что-то новое, на что пользователь ещё не смотрел». Сейчас
   * используется для пункта «Клоны» (новый CloneAccessGrant).
   */
  showDot?: boolean;
  /**
   * ТЗ 2026-05-27 onboarding-tour — id целевого элемента для тура. Если
   * задан, к <Link> добавляется `data-tour-target="<value>"`.
   */
  tourTarget?: string;
};

type NavSubgroup = {
  label: string;
  items: NavItem[];
  defaultCollapsed: boolean;
  /**
   * Если задан — состояние раскрытия персистится в localStorage по этому ключу.
   * Значение `'1'` = раскрыто, `'0'` = свёрнуто. По умолчанию (если ключа нет
   * в storage) используется `defaultCollapsed`.
   */
  storageKey?: string;
};

type NavGroup = {
  label: string;
  items: NavItem[];
  /**
   * Подгруппы внутри группы — с собственным collapse/expand и localStorage.
   * Рендерятся после `items`, сверху вниз. Если внутри одной из них активный
   * пункт — она автоматически раскрывается (как и раньше).
   */
  collapsibleSubgroups?: NavSubgroup[];
  /**
   * ТЗ 2026-05-27 — если true, заголовок группы не рендерится. Используется
   * для «Справочника»: вся группа — это одна collapsible-подгруппа, и
   * показывать заголовок дважды (группы + подгруппы) избыточно.
   */
  hideGroupLabel?: boolean;
};

/**
 * Пункты подгруппы «Память компании» (ТЗ 2026-05-26-memory-section-ui).
 *
 * Это shared knowledge: то, что Кора извлекла из встреч и разговоров.
 * Доступ — через `useMemoryAccess()`: manager+ всегда видит; member —
 * только если admin Org включил соответствующий feature-флаг.
 */
const MEMORY_SUBGROUP_ITEMS: NavItem[] = [
  // SBA β-5 — реестр идей и запросов клиентов (доступ всем member по умолчанию).
  { href: '/ideas', label: 'Идеи', icon: Lightbulb, matchPrefix: '/ideas' },
  // SBA α-7 — Regulation / Process / Policy.
  { href: '/regulations', label: 'Правила и стандарты', icon: ClipboardList, matchPrefix: '/regulations' },
  // SBA β-3 — реестр решений компании.
  { href: '/decisions', label: 'Решения', icon: ClipboardList, matchPrefix: '/decisions' },
  // SBA β-4 — повторяющиеся сигналы (problems / risks / blockers).
  { href: '/insights', label: 'Сигналы', icon: AlertTriangle, matchPrefix: '/insights' },
  // ТЗ 2026-05-26 §3 — реестр сущностей (entity browser).
  { href: '/entities', label: 'Сущности', icon: Network, matchPrefix: '/entities' },
  {
    href: '/themes',
    label: 'Темы',
    icon: Sparkles,
    matchPrefix: '/themes',
    gateFeature: 'feature.theme',
  },
];

/**
 * ТЗ 2026-05-27 navigation-restructure — меню разбито на 6 смысловых слоёв
 * по частоте использования и природе данных вместо плоских 3 групп:
 *   1. Каждый день — daily drivers (встречи/трекер/помощник)
 *   2. Моё пространство — личный кабинет
 *   3. Память компании — knowledge-граф (доступ через useMemoryAccess)
 *   4. Управление — ролевые дашборды (owner/admin/coo)
 *   5. Справочник — структура и метаданные (collapsible, default свёрнут)
 *   6. Настройки — конфиг + админка
 */
const DAILY_GROUP: NavGroup = {
  label: 'Каждый день',
  items: [
    { href: '/dashboard', label: 'Главная', icon: Home, matchPrefix: '/dashboard', tourTarget: 'welcome.sidebar-home' },
    { href: '/meetings', label: 'Встречи', icon: CalendarDays, matchPrefix: '/meetings', tourTarget: 'welcome.sidebar-meetings' },
    { href: '/dump', label: 'Дамп', icon: Brain, matchPrefix: '/dump' },
    { href: '/cards', label: 'Карточки', icon: FolderKanban, matchPrefix: '/cards', tourTarget: 'welcome.sidebar-cards' },
    { href: '/projects', label: 'Проекты', icon: ListChecks, matchPrefix: '/projects', tourTarget: 'welcome.sidebar-projects' },
    // Sprints (2026-05-27) — Wave 4 frontend, отдельный раздел рядом с трекером.
    { href: '/sprints', label: 'Спринты', icon: Rocket, matchPrefix: '/sprints', tourTarget: 'welcome.sprints' },
    {
      href: '/chat',
      label: 'Помощник компании',
      icon: MessageCircle,
      matchPrefix: '/chat',
      gateFeature: 'feature.chat_org',
      tourTarget: 'welcome.sidebar-chat',
    },
  ],
};

const ME_GROUP: NavGroup = {
  label: 'Моё пространство',
  items: [
    { href: '/me', label: 'Я', icon: UserRound, matchPrefix: '/me' },
    { href: '/me/contributions', label: 'Мой вклад', icon: Sparkles, matchPrefix: '/me/contributions' },
    { href: '/me/social-contribution', label: 'Мой вклад в команду', icon: HeartHandshake, matchPrefix: '/me/social-contribution' },
    // SBA β-8.2 — «Мои обещания».
    { href: '/me/promises', label: 'Мои обещания', icon: CheckCircle2, matchPrefix: '/me/promises' },
    // 2026-05-25 user-feedback-with-ai-clustering — канал предложений пользователей.
    { href: '/feedback', label: 'Ваши предложения', icon: MessageCircle, matchPrefix: '/feedback' },
  ],
};

/**
 * Память компании — это то, что Кора извлекла из встреч и разговоров.
 * Раньше была подгруппой внутри «Компании»; в ТЗ 2026-05-27 поднята на
 * верхний уровень — это отдельный, самостоятельный пласт продукта.
 * Доступ к items фильтруется через `useMemoryAccess()` (см. ниже).
 */
const MEMORY_GROUP: NavGroup = {
  label: 'Память компании',
  items: MEMORY_SUBGROUP_ITEMS,
};

/**
 * Управление — ролевые дашборды для owner/admin/coo. Группа целиком
 * условная: рендерится только при `canSeeOperationsCoo === true`.
 * `/goals` остаётся гейтнутым по тарифу (feature.goals_strategy).
 */
const MANAGEMENT_GROUP: NavGroup = {
  label: 'Управление',
  items: [
    // SBA β-8 / β-8.1 / β-8.3 — COO-панели.
    { href: '/dashboard/operations', label: 'Панель операций', icon: Activity, matchPrefix: '/dashboard/operations' },
    { href: '/dashboard/operations/daily', label: 'Ежедневный отчёт', icon: Newspaper, matchPrefix: '/dashboard/operations/daily' },
    { href: '/dashboard/operations/weekly', label: 'Недельная сводка', icon: BarChart3, matchPrefix: '/dashboard/operations/weekly' },
    {
      href: '/goals',
      label: 'Цели и стратегия',
      icon: Target,
      matchPrefix: '/goals',
      gateFeature: 'feature.goals_strategy',
    },
  ],
};

/**
 * Справочник — статические/редко-меняемые срезы компании. Целая группа —
 * collapsible (defaultCollapsed: true). Реализовано как единственная
 * подгруппа с `hideGroupLabel: true`, чтобы заголовок не дублировался.
 *
 * «Будет в следующей фазе» (Процессы/Политики/Метрики) — вторая подгруппа
 * внутри Справочника, тоже collapsed по умолчанию.
 */
const REFERENCE_GROUP: NavGroup = {
  label: 'Справочник',
  items: [],
  hideGroupLabel: true,
  collapsibleSubgroups: [
    {
      label: 'Справочник',
      defaultCollapsed: true,
      storageKey: 'sidebar.reference.open',
      items: [
        { href: '/structure', label: 'Структура', icon: Network, matchPrefix: '/structure' },
        // SBA α-9 wave 3 — Company Foundation.
        { href: '/company', label: 'Компания', icon: Building2, matchPrefix: '/company' },
        { href: '/departments', label: 'Отделы', icon: Network, matchPrefix: '/departments' },
        { href: '/domains', label: 'Домены', icon: Shapes, matchPrefix: '/domains' },
        { href: '/maturity', label: 'Зрелость', icon: Gauge, matchPrefix: '/maturity' },
        { href: '/documents', label: 'Документы', icon: FileText, matchPrefix: '/documents' },
        { href: '/roles', label: 'Карты должностей', icon: IdCard, matchPrefix: '/roles' },
        // Clones=Roles Ф4 — публичная витрина клонов должностей.
        { href: '/clones', label: 'Клоны', icon: Bot, matchPrefix: '/clones' },
        // SBA α-3 — поставщики/события (категория A онтологии).
        { href: '/vendors', label: 'Поставщики', icon: Truck, matchPrefix: '/vendors' },
        { href: '/events', label: 'События', icon: CalendarClock, matchPrefix: '/events' },
        // SBA β-6 — институциональная память: эксперименты и их уроки.
        { href: '/experiments', label: 'Эксперименты', icon: FlaskConical, matchPrefix: '/experiments' },
        // SBA β-7 — голос бренда (Specialist 3.10).
        { href: '/brand-voice', label: 'Голос бренда', icon: Palette, matchPrefix: '/brand-voice' },
      ],
    },
    {
      label: 'Будет в следующей фазе',
      defaultCollapsed: true,
      items: [
        // ТЗ 2026-05-26: /processes остаётся coming-soon (отдельное ТЗ).
        { href: '/processes', label: 'Процессы', icon: Workflow, matchPrefix: '/processes', comingSoon: true },
        { href: '/policies', label: 'Политики', icon: Scale, matchPrefix: '/policies', comingSoon: true },
        { href: '/metrics', label: 'Метрики', icon: Gauge, matchPrefix: '/metrics', comingSoon: true },
      ],
    },
  ],
};

/**
 * Доп. пункт «Входящие» (Phase 3 Sprint 6) — только для owner/admin.
 * Вставляется в `OPERATIONS_GROUP` динамически в Sidebar (роль приходит
 * с клиента, поэтому здесь нельзя жёстко прописать в массиве выше).
 */
const INTAKE_NAV_ITEM: NavItem = {
  href: '/intake',
  label: 'Входящие',
  icon: Inbox,
  matchPrefix: '/intake',
  tourTarget: 'welcome.sidebar-intake',
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
  const { isSuperAdmin, currentOrgRole, currentOrgId } = useAuth();
  // Phase 3 Sprint 6: счётчик pending-intake для бейджа у пункта «Входящие».
  // Запрос делается ТОЛЬКО для owner/admin (см. enabled).
  const canTriage =
    currentOrgRole === 'owner' || currentOrgRole === 'admin';
  const { count: intakePendingCount } = useIntakePendingCount(
    currentOrgId,
    canTriage,
  );
  // ТЗ 2026-05-26 §5.5 — точка возле «Клоны», если выдан новый grant,
  // который пользователь ещё не видел (сравнение по количеству grants
  // в localStorage). Тушится при заходе на /clones.
  const hasUnseenCloneGrants = useUnseenCloneGrants(currentOrgId);

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
      label: 'Суперадмин',
      icon: Shield,
      matchPrefix: '/admin',
    });
  }

  const settingsGroup: NavGroup = {
    label: 'Настройки',
    items: SETTINGS_BASE_ITEMS,
    ...(adminItems.length
      ? {
          collapsibleSubgroups: [
            {
              label: 'Админка',
              defaultCollapsed: false,
              items: adminItems,
            },
          ],
        }
      : {}),
  };

  // SBA β-8 / β-8.1 — «Управление» (ролевые дашборды) видно только
  // owner/admin/coo. В ТЗ 2026-05-27 эта секция вынесена в отдельную
  // верхнеуровневую группу `MANAGEMENT_GROUP` (раньше пункты COO-панели
  // вшивались в «Оперативку»).
  const canSeeOperationsCoo =
    currentOrgRole === 'owner' ||
    currentOrgRole === 'admin' ||
    currentOrgRole === 'coo';

  // Phase 3 Sprint 6: для owner/admin добавляем пункт «Входящие» в группу
  // «Каждый день» (рядом с «Проекты» / трекером). badgeCount тянется из
  // useIntakePendingCount — живой счётчик pending-карточек, обновляется
  // каждые 60 сек.
  const dailyGroup: NavGroup = (() => {
    if (!canTriage) return DAILY_GROUP;
    const items: NavItem[] = [...DAILY_GROUP.items];
    const projectsIdx = items.findIndex((i) => i.href === '/projects');
    const insertAt = projectsIdx >= 0 ? projectsIdx + 1 : items.length;
    items.splice(insertAt, 0, {
      ...INTAKE_NAV_ITEM,
      badgeCount: intakePendingCount,
    });
    return { ...DAILY_GROUP, items };
  })();

  // ТЗ 2026-05-26 §6 — фильтруем пункты «Памяти компании» в зависимости от
  // того, что пользователю разрешено видеть (роль + entitlement-флаги).
  const memoryAccess = useMemoryAccess();

  const memoryGroup: NavGroup = {
    ...MEMORY_GROUP,
    items: MEMORY_GROUP.items.filter((it) => {
      if (it.href === '/regulations') return memoryAccess.canReadRegulations;
      if (it.href === '/entities') return memoryAccess.canReadEntities;
      return true;
    }),
  };

  // ТЗ 2026-05-26 §5.5 — точка возле «Клоны» (новый CloneAccessGrant).
  // После ТЗ 2026-05-27 пункт «Клоны» живёт в «Справочнике».
  const referenceGroup: NavGroup = (() => {
    const subgroups = REFERENCE_GROUP.collapsibleSubgroups?.map((sg) => {
      if (sg.storageKey !== 'sidebar.reference.open') return sg;
      return {
        ...sg,
        items: sg.items.map((i) =>
          i.href === '/clones' ? { ...i, showDot: hasUnseenCloneGrants } : i,
        ),
      };
    });
    return {
      ...REFERENCE_GROUP,
      ...(subgroups ? { collapsibleSubgroups: subgroups } : {}),
    };
  })();

  const groups: NavGroup[] = [
    dailyGroup,
    ME_GROUP,
    memoryGroup,
    ...(canSeeOperationsCoo ? [MANAGEMENT_GROUP] : []),
    referenceGroup,
    settingsGroup,
  ];

  // Собираем все пункты в один плоский массив, чтобы вычислить «победителя»
  // по matchPrefix один раз — поведение, как было в плоском Sidebar (см.
  // оригинальный код, фильтр по самому специфичному matchPrefix).
  const allItems: NavItem[] = groups.flatMap((g) => [
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
        'flex h-full w-sb shrink-0 flex-col border-r border-border-subtle bg-bg-surface',
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
          data-tour-target="welcome.sidebar-logo"
        >
          <div className="grid h-7 w-7 place-items-center rounded-md bg-accent font-mono text-sm font-bold text-accent-fg">
            К
          </div>
          <span className="text-lg font-semibold tracking-tight text-fg-primary">Кора</span>
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
      {!group.hideGroupLabel && (
        <div className="mt-3 mb-1 px-3 text-xs uppercase tracking-wider text-fg-tertiary">
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
          subgroup={sg}
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
  subgroup: NavSubgroup;
  winnerHref: string | null;
  onNavigate?: () => void;
}) {
  // ТЗ 2026-05-26 §5: подгруппа «Память компании» персистит состояние
  // collapse в localStorage. При первом монтировании читаем сохранённое
  // значение; если ключа нет — берём `defaultCollapsed`.
  const [collapsed, setCollapsed] = useState(subgroup.defaultCollapsed);

  useEffect(() => {
    if (!subgroup.storageKey) return;
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem(subgroup.storageKey);
      if (stored === '0') setCollapsed(false);
      else if (stored === '1') setCollapsed(true);
    } catch {
      // localStorage недоступен (приватный режим, SSR) — игнорируем.
    }
  }, [subgroup.storageKey]);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      if (subgroup.storageKey && typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(subgroup.storageKey, next ? '1' : '0');
        } catch {
          // ignore
        }
      }
      return next;
    });
  };

  // Если внутри подгруппы есть активный пункт — раскрываем автоматически.
  const hasActive = subgroup.items.some((i) => i.href === winnerHref);
  const effectiveCollapsed = hasActive ? false : collapsed;

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={toggle}
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
    'relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors';

  let stateClass: string;
  if (isActive) {
    stateClass = 'bg-accent-muted font-medium text-accent-fg dark:shadow-accent-focus';
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

  // Badge непрочитанных (Phase 3 Sprint 6 — для «Входящие»). Скрыт, если
  // 0/undefined. >99 — рисуем «99+», чтобы не растягивать пункт.
  const badge =
    item.badgeCount !== undefined && item.badgeCount > 0
      ? item.badgeCount > 99
        ? '99+'
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
            'inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none',
            'bg-accent text-accent-fg',
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
      {...(item.tourTarget
        ? { 'data-tour-target': item.tourTarget }
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
