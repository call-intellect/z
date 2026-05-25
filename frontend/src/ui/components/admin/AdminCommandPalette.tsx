'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Calendar,
  ChevronRight,
  Layers,
  Loader2,
  ListTree,
  Search,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Command as CommandPrimitive } from 'cmdk';

import {
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/ui/shadcn/command';
import { Dialog, DialogContent } from '@/ui/shadcn/dialog';
import { apiClient } from '@/api/api-client';
import {
  ADMIN_NAV_FLAT,
  ADMIN_NAV_SECTIONS,
} from '@app/(authenticated)/admin/navigation';
import { LLM_TASK_TYPES } from '@/api/admin-llm-routes.api';

// ─────────────────────────────────────── типы action ─────────────────

/**
 * Регистрируемое снаружи действие. Команды раздела регистрируют свои
 * «быстрые действия» через `registerActions()` — палитра показывает их в
 * секции «Быстрые действия».
 */
export type AdminPaletteAction = {
  id: string;
  label: string;
  hint?: string;
  icon?: LucideIcon;
  /** Срабатывает при выборе. После — палитра закрывается. */
  perform: () => void | Promise<void>;
  /** Если true — перед запуском показать confirm с текстом. */
  confirmText?: string;
};

// ─────────────────────────────────── Provider/Context ────────────────

type PaletteContextValue = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** Зарегистрировать набор действий. Возвращает unregister(). */
  registerActions: (actions: AdminPaletteAction[]) => () => void;
  actions: AdminPaletteAction[];
};

const PaletteContext = createContext<PaletteContextValue | null>(null);

export function AdminCommandPaletteProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [actions, setActions] = useState<AdminPaletteAction[]>([]);
  const groupsRef = useRef<Map<symbol, AdminPaletteAction[]>>(new Map());

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  const recompute = useCallback(() => {
    const all: AdminPaletteAction[] = [];
    for (const group of groupsRef.current.values()) {
      for (const a of group) all.push(a);
    }
    setActions(all);
  }, []);

  const registerActions = useCallback(
    (next: AdminPaletteAction[]) => {
      const token = Symbol('palette-actions');
      groupsRef.current.set(token, next);
      recompute();
      return () => {
        groupsRef.current.delete(token);
        recompute();
      };
    },
    [recompute],
  );

  // Глобальный Cmd+K / Ctrl+K. Игнорируем, если фокус в инпуте редактирования
  // — пользователь может нажать ⌘K в textarea и не ждать палитру (но это
  // редкий кейс; cmdk сам не клейтает фокус — оставляем обычное поведение).
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const isPaletteShortcut =
        (e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K');
      if (!isPaletteShortcut) return;
      e.preventDefault();
      setIsOpen((v) => !v);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const value = useMemo<PaletteContextValue>(
    () => ({ isOpen, open, close, toggle, registerActions, actions }),
    [isOpen, open, close, toggle, registerActions, actions],
  );

  return (
    <PaletteContext.Provider value={value}>
      {children}
      <AdminCommandPalette />
    </PaletteContext.Provider>
  );
}

export function useAdminCommandPalette(): PaletteContextValue {
  const ctx = useContext(PaletteContext);
  if (!ctx) {
    throw new Error(
      'useAdminCommandPalette должен использоваться внутри <AdminCommandPaletteProvider>',
    );
  }
  return ctx;
}

// ─────────────────────────────────────── палитра ─────────────────────

type AdminSearchHit = {
  id: string;
  label: string;
  hint?: string;
  href: string;
};

type AdminSearchResponse = {
  orgs?: AdminSearchHit[];
  users?: AdminSearchHit[];
  meetings?: AdminSearchHit[];
};

/**
 * Внутренний компонент палитры. Не экспортируем — открывается только через
 * `useAdminCommandPalette().open()`.
 */
function AdminCommandPalette() {
  const router = useRouter();
  const { isOpen, close, actions } = useAdminCommandPalette();

  const [query, setQuery] = useState('');
  const [serverHits, setServerHits] = useState<AdminSearchResponse | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverLoading, setServerLoading] = useState(false);

  const trimmed = query.trim();

  // Сброс состояния при закрытии.
  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setServerHits(null);
      setServerError(null);
      setServerLoading(false);
    }
  }, [isOpen]);

  // Server-side поиск (debounce 200ms) — orgs/users/meetings.
  useEffect(() => {
    if (!isOpen || trimmed.length < 2) {
      setServerHits(null);
      setServerLoading(false);
      return;
    }
    let cancelled = false;
    setServerLoading(true);
    setServerError(null);
    const timer = window.setTimeout(async () => {
      try {
        // Бэкенд эндпоинта `/admin/search` ещё нет (создаётся в этой же
        // фазе на backend-стороне). При 404 — мягкое скрытие секции.
        const params = new URLSearchParams({ q: trimmed, limit: '5' });
        const result = await apiClient.get<AdminSearchResponse>(
          `/api/v1/admin/search?${params.toString()}`,
        );
        if (cancelled) return;
        setServerHits(result);
      } catch (err) {
        if (cancelled) return;
        // Молча: эндпоинта может ещё не быть на бэкенде — это нормально.
        setServerHits(null);
        setServerError(err instanceof Error ? err.message : 'Ошибка поиска');
      } finally {
        if (!cancelled) setServerLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [trimmed, isOpen]);

  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );

  const performAction = useCallback(
    async (action: AdminPaletteAction) => {
      if (action.confirmText) {
        const ok = window.confirm(action.confirmText);
        if (!ok) return;
      }
      close();
      try {
        await action.perform();
      } catch {
        // Ошибки выполнения остаются на ответственности action.perform.
      }
    },
    [close],
  );

  // Локальная фильтрация по нав-разделам и taskType — без сети.
  const matchedNav = useMemo(() => {
    if (trimmed.length === 0) return ADMIN_NAV_FLAT.slice(0, 8);
    const q = trimmed.toLowerCase();
    return ADMIN_NAV_FLAT.filter(
      (it) =>
        it.label.toLowerCase().includes(q) ||
        it.sectionLabel.toLowerCase().includes(q),
    ).slice(0, 12);
  }, [trimmed]);

  const matchedTasks = useMemo(() => {
    if (trimmed.length === 0) return [];
    const q = trimmed.toLowerCase();
    return LLM_TASK_TYPES.filter((t) => t.toLowerCase().includes(q)).slice(
      0,
      8,
    );
  }, [trimmed]);

  const matchedActions = useMemo(() => {
    if (trimmed.length === 0) return actions.slice(0, 8);
    const q = trimmed.toLowerCase();
    return actions
      .filter(
        (a) =>
          a.label.toLowerCase().includes(q) ||
          (a.hint ?? '').toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [actions, trimmed]);

  const showServerSections =
    trimmed.length >= 2 && serverError === null && serverHits !== null;
  const orgs = showServerSections ? (serverHits?.orgs ?? []) : [];
  const users = showServerSections ? (serverHits?.users ?? []) : [];
  const meetings = showServerSections ? (serverHits?.meetings ?? []) : [];

  return (
    <Dialog open={isOpen} onOpenChange={(next) => (next ? null : close())}>
      <DialogContent className="overflow-hidden p-0 shadow-modal sm:max-w-xl">
        <CommandPrimitive
          shouldFilter={false}
          className="flex h-full w-full flex-col overflow-hidden rounded-md bg-bg-card text-fg-primary [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-tertiary [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-4 [&_[cmdk-input-wrapper]_svg]:w-4 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2.5 [&_[cmdk-item]_svg]:h-4 [&_[cmdk-item]_svg]:w-4"
        >
          <CommandInput
            placeholder="Найдите раздел, оргу, пользователя или встречу"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-[60vh] md:max-h-[460px]">
            {trimmed.length === 0 ? (
              <div className="border-b border-border-subtle px-4 py-2 text-[11px] text-fg-tertiary">
                Подсказка: ⌘K / Ctrl+K открывает палитру в любой момент.
                Несколько первых разделов и быстрых действий — внизу.
              </div>
            ) : null}

            {matchedNav.length > 0 ? (
              <CommandGroup heading="Разделы">
                {matchedNav.map((item) => {
                  const Icon = item.icon;
                  return (
                    <CommandItem
                      key={`nav-${item.href}`}
                      value={`nav-${item.href}`}
                      onSelect={() => go(item.href)}
                    >
                      <PaletteRow
                        icon={Icon}
                        title={item.label}
                        subtitle={item.sectionLabel}
                      />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null}

            {matchedActions.length > 0 ? (
              <CommandGroup heading="Быстрые действия">
                {matchedActions.map((a) => (
                  <CommandItem
                    key={`act-${a.id}`}
                    value={`act-${a.id}`}
                    onSelect={() => void performAction(a)}
                  >
                    <PaletteRow
                      icon={a.icon ?? Layers}
                      title={a.label}
                      subtitle={a.hint ?? 'действие'}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {matchedTasks.length > 0 ? (
              <CommandGroup heading="Функции LLM">
                {matchedTasks.map((task) => (
                  <CommandItem
                    key={`task-${task}`}
                    value={`task-${task}`}
                    onSelect={() => go(`/admin/ai-models?task=${task}`)}
                  >
                    <PaletteRow
                      icon={ListTree}
                      title={task}
                      subtitle="taskType роутер моделей"
                      mono
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {serverLoading ? (
              <div className="flex items-center gap-2 px-4 py-3 text-xs text-fg-tertiary">
                <Loader2 size={12} className="animate-spin" aria-hidden />
                Ищу на сервере…
              </div>
            ) : null}

            {orgs.length > 0 ? (
              <CommandGroup heading="Организации">
                {orgs.map((o) => (
                  <CommandItem
                    key={`org-${o.id}`}
                    value={`org-${o.id}`}
                    onSelect={() => go(o.href)}
                  >
                    <PaletteRow
                      icon={Building2}
                      title={o.label}
                      subtitle={o.hint ?? 'организация'}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {users.length > 0 ? (
              <CommandGroup heading="Пользователи">
                {users.map((u) => (
                  <CommandItem
                    key={`user-${u.id}`}
                    value={`user-${u.id}`}
                    onSelect={() => go(u.href)}
                  >
                    <PaletteRow
                      icon={Users}
                      title={u.label}
                      subtitle={u.hint ?? 'пользователь'}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {meetings.length > 0 ? (
              <CommandGroup heading="Встречи">
                {meetings.map((m) => (
                  <CommandItem
                    key={`mt-${m.id}`}
                    value={`mt-${m.id}`}
                    onSelect={() => go(m.href)}
                  >
                    <PaletteRow
                      icon={Calendar}
                      title={m.label}
                      subtitle={m.hint ?? 'встреча'}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {trimmed.length === 0 ? (
              <CommandGroup heading="Категории сайдбара">
                {ADMIN_NAV_SECTIONS.map((section) => {
                  const Icon = section.icon;
                  return (
                    <CommandItem
                      key={`section-${section.key}`}
                      value={`section-${section.key}`}
                      onSelect={() =>
                        setQuery(section.label.toLowerCase())
                      }
                    >
                      <PaletteRow
                        icon={Icon}
                        title={section.label}
                        subtitle={`${section.items.length} разделов`}
                        rightSlot={
                          <ChevronRight
                            size={12}
                            className="text-fg-tertiary"
                            aria-hidden
                          />
                        }
                      />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null}

            {trimmed.length > 0 &&
            matchedNav.length === 0 &&
            matchedActions.length === 0 &&
            matchedTasks.length === 0 &&
            orgs.length === 0 &&
            users.length === 0 &&
            meetings.length === 0 &&
            !serverLoading ? (
              <CommandEmpty>
                <Search
                  size={16}
                  className="mb-2 inline-block text-fg-tertiary"
                  aria-hidden
                />
                <div>Ничего не найдено</div>
              </CommandEmpty>
            ) : null}
          </CommandList>
        </CommandPrimitive>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────────────── вспомогательные ───────────────

function PaletteRow({
  icon: Icon,
  title,
  subtitle,
  mono,
  rightSlot,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  mono?: boolean;
  rightSlot?: ReactNode;
}) {
  return (
    <div className="flex w-full items-center gap-2.5">
      <Icon size={14} className="text-fg-tertiary" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col">
        <span
          className={
            mono
              ? 'truncate font-mono text-sm text-fg-primary'
              : 'truncate text-sm text-fg-primary'
          }
        >
          {title}
        </span>
        <span className="truncate text-xs text-fg-tertiary">{subtitle}</span>
      </div>
      {rightSlot ? <span className="ml-auto shrink-0">{rightSlot}</span> : null}
    </div>
  );
}
