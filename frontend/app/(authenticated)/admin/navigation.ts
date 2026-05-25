/**
 * navigation.ts — единый источник правды по структуре сайдбара Z-Admin.
 *
 * Используется в:
 *   - `AdminShell.tsx` (двухуровневый сайдбар с collapsible-категориями)
 *   - `AdminCommandPalette.tsx` (Cmd+K-палитра, секция «Разделы»)
 *
 * Соответствует ТЗ редизайна (2026-05-25): 8 категорий, ~36 разделов.
 * Часть разделов помечена `isComingSoon: true` — каркас под будущие фазы
 * (Фаза 2+). Существующие URL-ы из старого сайдбара сохранены, чтобы не
 * сломать текущую работу — миграция URL под `/admin/analytics/*` и т.п.
 * пройдёт в следующих фазах.
 */

import {
  Activity,
  AlertTriangle,
  BarChart3,
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
  Inbox,
  KeyRound,
  Languages,
  LayoutGrid,
  LineChart,
  ListTree,
  Lock,
  Mail,
  Megaphone,
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
  Sparkles,
  Tag,
  Telescope,
  ToggleLeft,
  TrendingUp,
  Users,
  Video,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

/**
 * Один раздел внутри категории.
 *
 * - `href` — URL. Старые (существующие) разделы оставляем как есть.
 * - `matchPrefix` — для активного состояния (если sub-страница).
 * - `isComingSoon` — раздел ещё не реализован, рендерим в сайдбаре с бейджем.
 *   Cmd+K такие пропускает (нет смысла «переходить в пустоту»).
 */
export type AdminNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  matchPrefix?: string;
  /** Раздел запланирован, но пока не реализован. */
  isComingSoon?: boolean;
};

export type AdminNavSection = {
  key: string;
  label: string;
  icon: LucideIcon;
  items: AdminNavItem[];
};

export const ADMIN_NAV_SECTIONS: AdminNavSection[] = [
  // ─────────────────────────────────── 1. Пульс компании
  {
    key: 'pulse',
    label: 'Пульс',
    icon: Gauge,
    items: [
      { href: '/admin', label: 'Дашборд', icon: Gauge },
      {
        href: '/admin/health',
        label: 'Здоровье системы',
        icon: Activity,
        matchPrefix: '/admin/health',
      },
      {
        href: '/admin/incidents',
        label: 'Инциденты',
        icon: Siren,
        matchPrefix: '/admin/incidents',
      },
      {
        href: '/admin/audit',
        label: 'Журнал super_admin',
        icon: ClipboardList,
        matchPrefix: '/admin/audit',
      },
    ],
  },

  // ─────────────────────────────────── 2. Аналитика (read-only)
  {
    key: 'analytics',
    label: 'Аналитика',
    icon: BarChart3,
    items: [
      // Фаза 2 редизайна: все маршруты переехали под /admin/analytics/*.
      // Старые `/admin/usage/*` и `/admin/economics` редиректят сюда.
      {
        href: '/admin/analytics/orgs',
        label: 'Org и пользователи',
        icon: Users,
        matchPrefix: '/admin/analytics/orgs',
      },
      {
        href: '/admin/analytics/functions',
        label: 'Функции LLM',
        icon: ListTree,
        matchPrefix: '/admin/analytics/functions',
      },
      {
        href: '/admin/analytics/economics',
        label: 'Юнит-экономика',
        icon: TrendingUp,
        matchPrefix: '/admin/analytics/economics',
      },
      {
        href: '/admin/analytics/meetings',
        label: 'Встречи',
        icon: Calendar,
        matchPrefix: '/admin/analytics/meetings',
      },
      {
        href: '/admin/analytics/knowledge',
        label: 'Knowledge-Core',
        icon: Network,
        matchPrefix: '/admin/analytics/knowledge',
      },
      {
        href: '/admin/analytics/concierge',
        label: 'Concierge и AI-чат',
        icon: Telescope,
        matchPrefix: '/admin/analytics/concierge',
      },
      {
        href: '/admin/org/economics',
        label: 'Экономика моей Org',
        icon: LineChart,
      },
    ],
  },

  // ─────────────────────────────────── 3. AI и модели
  {
    key: 'ai',
    label: 'AI и модели',
    icon: Sparkles,
    items: [
      {
        href: '/admin/ai/routing',
        label: 'Роутинг моделей',
        icon: Sparkles,
        matchPrefix: '/admin/ai/routing',
      },
      {
        href: '/admin/llm-routes',
        label: 'Управление роутами LLM',
        icon: Network,
        matchPrefix: '/admin/llm-routes',
      },
      {
        href: '/admin/ai/catalog',
        label: 'Каталог LLM',
        icon: CircleDollarSign,
        matchPrefix: '/admin/ai/catalog',
      },
      {
        href: '/admin/ai/prompts',
        label: 'Промпты',
        icon: MessagesSquare,
        matchPrefix: '/admin/ai/prompts',
      },
      {
        href: '/admin/experiments',
        label: 'A/B-эксперименты',
        icon: FlaskConical,
        matchPrefix: '/admin/experiments',
      },
      {
        href: '/admin/ai/knowledge-core',
        label: 'Knowledge-Core настройки',
        icon: Brain,
        matchPrefix: '/admin/ai/knowledge-core',
      },
      {
        href: '/admin/ai/embeddings',
        label: 'Эмбеддинги',
        icon: DatabaseZap,
        matchPrefix: '/admin/ai/embeddings',
      },
    ],
  },

  // ─────────────────────────────────── 4. Тенанты (Org)
  {
    key: 'tenants',
    label: 'Тенанты',
    icon: Building2,
    items: [
      {
        href: '/admin/orgs',
        label: 'Список Org',
        icon: Building2,
        matchPrefix: '/admin/orgs',
      },
      {
        href: '/admin/orgs/plans',
        label: 'Тарифы (планы)',
        icon: CreditCard,
        matchPrefix: '/admin/orgs/plans',
      },
      {
        href: '/admin/orgs/entitlements',
        label: 'Entitlements (overrides)',
        icon: ToggleLeft,
        matchPrefix: '/admin/orgs/entitlements',
      },
    ],
  },

  // ─────────────────────────────────── 5. Контент продукта
  {
    key: 'content',
    label: 'Контент',
    icon: LayoutGrid,
    items: [
      {
        href: '/admin/content/meeting-types',
        label: 'Типы встреч',
        icon: Calendar,
        matchPrefix: '/admin/content/meeting-types',
      },
      {
        href: '/admin/content/emails',
        label: 'Email-шаблоны',
        icon: Mail,
        matchPrefix: '/admin/content/emails',
      },
      {
        href: '/admin/content/system-messages',
        label: 'Системные сообщения',
        icon: Megaphone,
        matchPrefix: '/admin/content/system-messages',
      },
      {
        href: '/admin/content/global-channels',
        label: 'Глобальные каналы',
        icon: FolderTree,
        matchPrefix: '/admin/content/global-channels',
      },
      {
        href: '/admin/content/copy',
        label: 'Глоссарий и UI-строки',
        icon: Languages,
        matchPrefix: '/admin/content/copy',
      },
    ],
  },

  // ─────────────────────────────────── 6. Каналы и интеграции
  {
    key: 'integrations',
    label: 'Каналы и интеграции',
    icon: Plug,
    items: [
      {
        href: '/admin/integrations/bots',
        label: 'Conversational боты',
        icon: MessagesSquare,
        matchPrefix: '/admin/integrations/bots',
      },
      {
        href: '/admin/system/telegram-bot',
        label: 'Telegram-бот',
        icon: Send,
        matchPrefix: '/admin/system/telegram-bot',
      },
      {
        href: '/admin/integrations/webhooks',
        label: 'Webhook subscriptions',
        icon: Plug,
        matchPrefix: '/admin/integrations/webhooks',
      },
      {
        href: '/admin/integrations/keys',
        label: 'Integration keys',
        icon: KeyRound,
        matchPrefix: '/admin/integration-keys',
      },
      {
        href: '/admin/integrations/livekit',
        label: 'LiveKit',
        icon: Video,
        matchPrefix: '/admin/integrations/livekit',
      },
    ],
  },

  // ─────────────────────────────────── 7. Записи и медиа
  {
    key: 'media',
    label: 'Записи и медиа',
    icon: Video,
    items: [
      // Фаза 7: все разделы переехали под /admin/media/*. Старые URL
      // (/admin/meetings, /admin/recordings/expiring) делают 308 redirect.
      {
        href: '/admin/media/meetings',
        label: 'Все встречи',
        icon: Video,
        matchPrefix: '/admin/media/meetings',
      },
      {
        href: '/admin/media/expiring',
        label: 'Истекающие записи',
        icon: PlayCircle,
        matchPrefix: '/admin/media/expiring',
      },
      {
        href: '/admin/media/retention',
        label: 'Сроки хранения',
        icon: Clock,
        matchPrefix: '/admin/media/retention',
      },
      {
        href: '/admin/media/storage',
        label: 'S3 хранилище',
        icon: HardDrive,
        matchPrefix: '/admin/media/storage',
      },
    ],
  },

  // ─────────────────────────────────── 8. Платформа
  {
    key: 'platform',
    label: 'Платформа',
    icon: Server,
    items: [
      {
        href: '/admin/platform/crons',
        label: 'Кроны',
        icon: Repeat,
        matchPrefix: '/admin/platform/crons',
      },
      {
        href: '/admin/platform/workers',
        label: 'Воркеры BullMQ',
        icon: Boxes,
        matchPrefix: '/admin/platform/workers',
      },
      {
        href: '/admin/platform/limits',
        label: 'Лимиты и квоты',
        icon: Tag,
        matchPrefix: '/admin/platform/limits',
      },
      {
        href: '/admin/platform/flags',
        label: 'Feature flags',
        icon: ToggleLeft,
        matchPrefix: '/admin/platform/flags',
      },
      {
        href: '/admin/platform/security',
        label: 'Безопасность',
        icon: Lock,
        matchPrefix: '/admin/platform/security',
      },
      {
        href: '/admin/platform/maintenance',
        label: 'Бэкапы и обслуживание',
        icon: Wrench,
        matchPrefix: '/admin/platform/maintenance',
      },
    ],
  },
];

/**
 * Заранее посчитанный плоский список «реальных» (не coming-soon) разделов.
 * Используется в Cmd+K-палитре для быстрого поиска.
 */
export const ADMIN_NAV_FLAT: Array<AdminNavItem & { sectionLabel: string }> =
  ADMIN_NAV_SECTIONS.flatMap((section) =>
    section.items
      .filter((it) => !it.isComingSoon)
      .map((it) => ({ ...it, sectionLabel: section.label })),
  );

/** Полный список (включая coming-soon) — для подсказок в Cmd+K. */
export const ADMIN_NAV_FLAT_ALL: Array<AdminNavItem & { sectionLabel: string }> =
  ADMIN_NAV_SECTIONS.flatMap((section) =>
    section.items.map((it) => ({ ...it, sectionLabel: section.label })),
  );

/** Определить активную категорию по текущему pathname. */
export function findActiveSectionKey(pathname: string): string | null {
  for (const section of ADMIN_NAV_SECTIONS) {
    for (const item of section.items) {
      const prefix = item.matchPrefix ?? item.href;
      if (item.href === '/admin') {
        if (pathname === '/admin') return section.key;
        continue;
      }
      if (pathname === item.href || pathname.startsWith(`${prefix}/`)) {
        return section.key;
      }
    }
  }
  return null;
}

/** Проверка активности отдельного пункта. */
export function isAdminNavItemActive(
  item: AdminNavItem,
  pathname: string,
): boolean {
  if (item.href === '/admin') return pathname === '/admin';
  const prefix = item.matchPrefix ?? item.href;
  return pathname === item.href || pathname.startsWith(`${prefix}/`);
}

/** Полный список «реальных» (не coming-soon) URL-ов для быстрой проверки. */
export const ADMIN_NAV_REAL_HREFS: string[] = ADMIN_NAV_FLAT.map((it) => it.href);
