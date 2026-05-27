'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ChevronDown, FileText, Shield } from 'lucide-react';

import { cn } from '@/ui/shadcn/lib/utils';
import { AdminCommandPaletteProvider } from '@/ui/components/admin/AdminCommandPalette';
import {
  ADMIN_NAV_SECTIONS,
  findActiveSectionKey,
  isAdminNavItemActive,
  type AdminNavItem,
  type AdminNavSection,
} from './navigation';

/**
 * AdminShell — общий шелл Z-Admin.
 *
 * Структура:
 *   - Двухуровневый сайдбар: 8 категорий (`ADMIN_NAV_SECTIONS`), каждая
 *     collapsible. По умолчанию схлопнуты все, кроме той, что содержит
 *     активный путь. Состояние раскрытия хранится в localStorage
 *     (`admin.sidebar.expanded`).
 *   - Coming-soon разделы рендерятся с бейджем «скоро» — каркас под
 *     будущие фазы (`isComingSoon: true`).
 *   - Защита прав: каждая страница сама ловит 403 через `apiClient`.
 *
 * Cmd+K-палитра — через `AdminCommandPaletteProvider` (Provider оборачивает
 * всю админку, слушает ⌘K глобально).
 */

const LS_KEY = 'admin.sidebar.expanded';

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '';
  const activeSectionKey = useMemo(
    () => findActiveSectionKey(pathname),
    [pathname],
  );

  // Раскрытие категорий: загружаем из localStorage. Ленивая инициализация
  // на клиенте, на сервере — пустой объект.
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const raw = window.localStorage.getItem(LS_KEY);
      const parsed = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
      return parsed;
    } catch {
      return {};
    }
  });

  // При смене активной категории — гарантируем, что она раскрыта.
  useEffect(() => {
    if (!activeSectionKey) return;
    setExpanded((prev) => {
      if (prev[activeSectionKey]) return prev;
      const next = { ...prev, [activeSectionKey]: true };
      try {
        window.localStorage.setItem(LS_KEY, JSON.stringify(next));
      } catch {
        // localStorage может быть недоступен — игнорируем.
      }
      return next;
    });
  }, [activeSectionKey]);

  const toggleSection = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        window.localStorage.setItem(LS_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  return (
    <AdminCommandPaletteProvider>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-6 md:flex-row">
        <aside className="md:w-64 md:shrink-0">
          <div className="mb-3 flex items-center justify-between px-3 text-sm font-semibold uppercase tracking-wider text-fg-tertiary">
            <span className="flex items-center gap-2">
              <Shield size={14} className="text-accent-fg" />
              Z-Admin
            </span>
            <kbd className="hidden rounded border border-border-subtle bg-bg-overlay px-1.5 py-0.5 text-[10px] font-normal text-fg-tertiary md:inline-flex">
              ⌘K
            </kbd>
          </div>
          <nav className="rounded-lg border border-border-subtle bg-bg-card p-2">
            <div className="flex flex-col gap-1.5">
              {ADMIN_NAV_SECTIONS.map((section) => (
                <SectionGroup
                  key={section.key}
                  section={section}
                  pathname={pathname}
                  isActiveSection={activeSectionKey === section.key}
                  isExpanded={expanded[section.key] ?? false}
                  onToggle={() => toggleSection(section.key)}
                />
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
    </AdminCommandPaletteProvider>
  );
}

// ────────────────────────────── секция / пункт ───────────────────────

function SectionGroup({
  section,
  pathname,
  isActiveSection,
  isExpanded,
  onToggle,
}: {
  section: AdminNavSection;
  pathname: string;
  isActiveSection: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const Icon = section.icon;

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
          isActiveSection
            ? 'bg-accent-muted/40 text-fg-primary'
            : 'text-fg-secondary hover:bg-bg-overlay hover:text-fg-primary',
        )}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <Icon
            size={15}
            strokeWidth={1.75}
            className={isActiveSection ? 'text-accent-fg' : 'text-fg-tertiary'}
          />
          <span
            className={cn(
              'truncate',
              isActiveSection && 'font-medium',
            )}
          >
            {section.label}
          </span>
        </span>
        <ChevronDown
          size={14}
          className={cn(
            'shrink-0 text-fg-tertiary transition-transform duration-150',
            isExpanded ? 'rotate-0' : '-rotate-90',
          )}
          aria-hidden
        />
      </button>
      {isExpanded ? (
        <ul className="ml-3.5 mt-0.5 flex flex-col gap-0.5 border-l border-border-subtle pl-2">
          {section.items.map((item) => (
            <li key={item.href}>
              <NavLink item={item} pathname={pathname} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function NavLink({ item, pathname }: { item: AdminNavItem; pathname: string }) {
  const Icon = item.icon;
  const isActive = isAdminNavItemActive(item, pathname);

  // Coming-soon: визуально приглушённая, но всё ещё ссылка — при клике
  // отдастся 404 / соответствующий empty-state. Это нужно, чтобы оператор
  // мог визуально оценить структуру админки уже сейчас (каркас под Фазы 2+).
  return (
    <Link
      href={item.href}
      aria-disabled={item.isComingSoon}
      className={cn(
        'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
        isActive
          ? 'bg-accent-muted font-medium text-accent-fg'
          : 'text-fg-secondary hover:bg-bg-overlay hover:text-fg-primary',
        item.isComingSoon && !isActive && 'opacity-60',
      )}
    >
      <Icon size={14} strokeWidth={1.75} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.isComingSoon ? (
        <span className="ml-auto shrink-0 rounded-full border border-border-subtle bg-bg-overlay px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-fg-tertiary">
          скоро
        </span>
      ) : null}
    </Link>
  );
}
