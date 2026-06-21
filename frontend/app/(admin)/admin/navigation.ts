import {
  Activity,
  AlertTriangle,
  Archive,
  BarChart3,
  Bot,
  Boxes,
  Brain,
  Building2,
  Calendar,
  CircleDollarSign,
  ClipboardList,
  Clock,
  CreditCard,
  DatabaseZap,
  FileText,
  FlaskConical,
  FolderTree,
  Gauge,
  HardDrive,
  HelpCircle,
  Inbox,
  KeyRound,
  Languages,
  LayoutGrid,
  LineChart,
  ListTree,
  Lock,
  Mail,
  Megaphone,
  MessageCircle,
  MessagesSquare,
  Network,
  PlayCircle,
  Plug,
  Repeat,
  Send,
  Server,
  Settings2,
  ShieldCheck,
  Siren,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Telescope,
  ToggleLeft,
  TrendingUp,
  Users,
  Video,
  Wallet,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type AdminNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  matchPrefix?: string;
  isComingSoon?: boolean;
};

export type AdminNavSection = {
  key: string;
  label: string;
  icon: LucideIcon;
  items: AdminNavItem[];
};

export const ADMIN_NAV_SECTIONS: AdminNavSection[] = [
  {
    key: "pulse",
    label: "Пульс",
    icon: Gauge,
    items: [
      { href: "/admin", label: "Дашборд", icon: Gauge },
      {
        href: "/admin/health",
        label: "Здоровье системы",
        icon: Activity,
        matchPrefix: "/admin/health",
      },
      {
        href: "/admin/incidents",
        label: "Инциденты",
        icon: Siren,
        matchPrefix: "/admin/incidents",
      },
      {
        href: "/admin/audit",
        label: "Журнал super_admin",
        icon: ClipboardList,
        matchPrefix: "/admin/audit",
      },
      {
        href: "/admin/logs",
        label: "Технические логи",
        icon: FileText,
        matchPrefix: "/admin/logs",
      },
    ],
  },

  {
    key: "analytics",
    label: "Аналитика",
    icon: BarChart3,
    items: [
      {
        href: "/admin/analytics/orgs",
        label: "Org и пользователи",
        icon: Users,
        matchPrefix: "/admin/analytics/orgs",
      },
      {
        href: "/admin/analytics/functions",
        label: "Функции LLM",
        icon: ListTree,
        matchPrefix: "/admin/analytics/functions",
      },
      {
        href: "/admin/analytics/economics",
        label: "Юнит-экономика",
        icon: TrendingUp,
        matchPrefix: "/admin/analytics/economics",
      },
      {
        href: "/admin/analytics/meetings",
        label: "Встречи",
        icon: Calendar,
        matchPrefix: "/admin/analytics/meetings",
      },
      {
        href: "/admin/analytics/knowledge",
        label: "Knowledge-Core",
        icon: Network,
        matchPrefix: "/admin/analytics/knowledge",
      },
      {
        href: "/admin/analytics/concierge",
        label: "Concierge и AI-чат",
        icon: Telescope,
        matchPrefix: "/admin/analytics/concierge",
      },
      {
        href: "/admin/org/economics",
        label: "Экономика моей Org",
        icon: LineChart,
      },
    ],
  },

  {
    key: "ai",
    label: "AI и модели",
    icon: Sparkles,
    items: [
      {
        href: "/admin/ai/routing",
        label: "Роутинг моделей",
        icon: Sparkles,
        matchPrefix: "/admin/ai/routing",
      },
      {
        href: "/admin/llm-routes",
        label: "Управление роутами LLM",
        icon: Network,
        matchPrefix: "/admin/llm-routes",
      },
      {
        href: "/admin/ai/catalog",
        label: "Каталог LLM",
        icon: CircleDollarSign,
        matchPrefix: "/admin/ai/catalog",
      },
      {
        href: "/admin/ai/models",
        label: "Модели LLM и часы",
        icon: Clock,
        matchPrefix: "/admin/ai/models",
      },
      {
        href: "/admin/ai/concierge",
        label: "Помощник",
        icon: Bot,
        matchPrefix: "/admin/ai/concierge",
      },
      {
        href: "/admin/ai/orchestrator",
        label: "Оркестратор и маршрутизатор",
        icon: Workflow,
        matchPrefix: "/admin/ai/orchestrator",
      },
      {
        href: "/admin/ai/prompts",
        label: "Промпты",
        icon: MessagesSquare,
        matchPrefix: "/admin/ai/prompts",
      },
      {
        href: "/admin/probe",
        label: "Probe и курация",
        icon: HelpCircle,
        matchPrefix: "/admin/probe",
      },
      {
        href: "/admin/checkin-signals",
        label: "Фиксатор чек-инов",
        icon: ClipboardList,
        matchPrefix: "/admin/checkin-signals",
      },
      {
        href: "/admin/tracker",
        label: "Трекер",
        icon: Workflow,
        matchPrefix: "/admin/tracker",
      },
      {
        href: "/admin/experiments",
        label: "A/B-эксперименты",
        icon: FlaskConical,
        matchPrefix: "/admin/experiments",
      },
      {
        href: "/admin/ai/knowledge-core",
        label: "Knowledge-Core настройки",
        icon: Brain,
        matchPrefix: "/admin/ai/knowledge-core",
      },
      {
        href: "/admin/ai/embeddings",
        label: "Эмбеддинги",
        icon: DatabaseZap,
        matchPrefix: "/admin/ai/embeddings",
      },
      {
        href: "/admin/skill-trait-concepts",
        label: "Смысловые блоки навыка",
        icon: Brain,
        matchPrefix: "/admin/skill-trait-concepts",
      },
      {
        href: "/admin/clones",
        label: "Доступы к клонам",
        icon: ShieldCheck,
        matchPrefix: "/admin/clones",
      },
      {
        href: "/admin/ai/preference-dataset",
        label: "Preference dataset",
        icon: Inbox,
        matchPrefix: "/admin/ai/preference-dataset",
      },
      {
        href: "/admin/ai/signal-type-monitor",
        label: "Мониторинг signalType",
        icon: LineChart,
        matchPrefix: "/admin/ai/signal-type-monitor",
      },
    ],
  },

  {
    key: "tenants",
    label: "Тенанты",
    icon: Building2,
    items: [
      {
        href: "/admin/orgs",
        label: "Список Org",
        icon: Building2,
        matchPrefix: "/admin/orgs",
      },
      {
        href: "/admin/orgs/plans",
        label: "Тарифы (планы)",
        icon: CreditCard,
        matchPrefix: "/admin/orgs/plans",
      },
      {
        href: "/admin/orgs/entitlements",
        label: "Entitlements (overrides)",
        icon: ToggleLeft,
        matchPrefix: "/admin/orgs/entitlements",
      },
      {
        href: "/admin/billing-overview",
        label: "Биллинг — обзор",
        icon: Wallet,
        matchPrefix: "/admin/billing-overview",
      },
      {
        href: "/admin/demo",
        label: "Демо-кабинеты",
        icon: Sparkles,
        matchPrefix: "/admin/demo",
      },
    ],
  },

  {
    key: "content",
    label: "Контент",
    icon: LayoutGrid,
    items: [
      {
        href: "/admin/content/meeting-types",
        label: "Типы встреч",
        icon: Calendar,
        matchPrefix: "/admin/content/meeting-types",
      },
      {
        href: "/admin/content/emails",
        label: "Email-шаблоны",
        icon: Mail,
        matchPrefix: "/admin/content/emails",
      },
      {
        href: "/admin/content/system-messages",
        label: "Системные сообщения",
        icon: Megaphone,
        matchPrefix: "/admin/content/system-messages",
      },
      {
        href: "/admin/content/global-channels",
        label: "Глобальные каналы",
        icon: FolderTree,
        matchPrefix: "/admin/content/global-channels",
      },
      {
        href: "/admin/content/copy",
        label: "Глоссарий и UI-строки",
        icon: Languages,
        matchPrefix: "/admin/content/copy",
      },
    ],
  },

  {
    key: "integrations",
    label: "Каналы и интеграции",
    icon: Plug,
    items: [
      {
        href: "/admin/integrations/bots",
        label: "Conversational боты",
        icon: MessagesSquare,
        matchPrefix: "/admin/integrations/bots",
      },
      {
        href: "/admin/system/telegram-bot",
        label: "Telegram-бот",
        icon: Send,
        matchPrefix: "/admin/system/telegram-bot",
      },
      {
        href: "/admin/integrations/webhooks",
        label: "Webhook subscriptions",
        icon: Plug,
        matchPrefix: "/admin/integrations/webhooks",
      },
      {
        href: "/admin/integrations/keys",
        label: "Integration keys",
        icon: KeyRound,
        matchPrefix: "/admin/integration-keys",
      },
      {
        href: "/admin/integrations/livekit",
        label: "LiveKit",
        icon: Video,
        matchPrefix: "/admin/integrations/livekit",
      },
      {
        href: "/admin/integrations/sources",
        label: "Bitrix / ChatBox",
        icon: DatabaseZap,
        matchPrefix: "/admin/integrations/sources",
      },
    ],
  },

  {
    key: "media",
    label: "Записи и медиа",
    icon: Video,
    items: [
      {
        href: "/admin/media/meetings",
        label: "Все встречи",
        icon: Video,
        matchPrefix: "/admin/media/meetings",
      },
      {
        href: "/admin/media/expiring",
        label: "Истекающие записи",
        icon: PlayCircle,
        matchPrefix: "/admin/media/expiring",
      },
      {
        href: "/admin/media/retention",
        label: "Сроки хранения",
        icon: Clock,
        matchPrefix: "/admin/media/retention",
      },
      {
        href: "/admin/media/storage",
        label: "S3 хранилище",
        icon: HardDrive,
        matchPrefix: "/admin/media/storage",
      },
    ],
  },

  {
    key: "platform",
    label: "Платформа",
    icon: Server,
    items: [
      {
        href: "/admin/platform/crons",
        label: "Кроны",
        icon: Repeat,
        matchPrefix: "/admin/platform/crons",
      },
      {
        href: "/admin/platform/workers",
        label: "Воркеры BullMQ",
        icon: Boxes,
        matchPrefix: "/admin/platform/workers",
      },
      {
        href: "/admin/platform/worker-knobs",
        label: "Рубильники воркеров",
        icon: SlidersHorizontal,
        matchPrefix: "/admin/platform/worker-knobs",
      },
      {
        href: "/admin/platform/limits",
        label: "Лимиты и квоты",
        icon: Tag,
        matchPrefix: "/admin/platform/limits",
      },
      {
        href: "/admin/platform/quotas",
        label: "Квоты пользователей",
        icon: Gauge,
        matchPrefix: "/admin/platform/quotas",
      },
      {
        href: "/admin/platform/retention-logging",
        label: "Хранение и логи",
        icon: Archive,
        matchPrefix: "/admin/platform/retention-logging",
      },
      {
        href: "/admin/platform/flags",
        label: "Feature flags",
        icon: ToggleLeft,
        matchPrefix: "/admin/platform/flags",
      },
      {
        href: "/admin/platform/security",
        label: "Безопасность",
        icon: Lock,
        matchPrefix: "/admin/platform/security",
      },
      {
        href: "/admin/feedback",
        label: "Обратная связь",
        icon: MessageCircle,
        matchPrefix: "/admin/feedback",
      },
      {
        href: "/admin/platform/maintenance",
        label: "Бэкапы и обслуживание",
        icon: Wrench,
        matchPrefix: "/admin/platform/maintenance",
      },
    ],
  },
];

export const ADMIN_NAV_FLAT: Array<AdminNavItem & { sectionLabel: string }> =
  ADMIN_NAV_SECTIONS.flatMap((section) =>
    section.items
      .filter((it) => !it.isComingSoon)
      .map((it) => ({ ...it, sectionLabel: section.label })),
  );

export function findActiveSectionKey(pathname: string): string | null {
  for (const section of ADMIN_NAV_SECTIONS) {
    for (const item of section.items) {
      const prefix = item.matchPrefix ?? item.href;
      if (item.href === "/admin") {
        if (pathname === "/admin") return section.key;
        continue;
      }
      if (pathname === item.href || pathname.startsWith(`${prefix}/`)) {
        return section.key;
      }
    }
  }
  return null;
}

export function isAdminNavItemActive(
  item: AdminNavItem,
  pathname: string,
): boolean {
  if (item.href === "/admin") return pathname === "/admin";
  const prefix = item.matchPrefix ?? item.href;
  return pathname === item.href || pathname.startsWith(`${prefix}/`);
}
