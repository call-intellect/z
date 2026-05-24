'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * Wave 2 B2 — CommandPaletteProvider.
 *
 * Глобальный контекст для открытия/закрытия командной палитры из любого
 * места приложения: topbar-кнопки «⌘K», кнопки «Спросить AI» внутри
 * страниц, deep-link `?cmdk=open` (на будущее), etc.
 *
 * Глобальный keyboard listener (Cmd+K / Ctrl+K) живёт здесь — listener
 * вешается единожды на window, чтобы не зависеть от того, смонтирован ли
 * сам `<CommandPalette>` уже или ещё нет в момент нажатия. Это также
 * позволяет избежать дубликата listener'а из самого компонента палитры.
 *
 * Использование:
 *
 *   // в layout
 *   <CommandPaletteProvider>
 *     <CommandPalette />
 *     {children}
 *   </CommandPaletteProvider>
 *
 *   // в любом компоненте
 *   const { open: openPalette } = useCommandPalette();
 *   <button onClick={() => openPalette()}>⌘K</button>
 */

export type CommandPaletteInitialMode = 'search' | 'ai';

type OpenOptions = {
  /** Начальный режим (по умолчанию `search` = пустая строка). */
  mode?: CommandPaletteInitialMode;
  /** Начальный текст в инпуте (например, выделение со страницы). */
  initialQuery?: string;
};

type CommandPaletteContextValue = {
  isOpen: boolean;
  /** Начальный query, заданный последним `open({ initialQuery })`. */
  initialQuery: string | null;
  /** Начальный mode для следующего открытия (использует CommandPalette). */
  initialMode: CommandPaletteInitialMode;
  open: (opts?: OpenOptions) => void;
  close: () => void;
  toggle: () => void;
  /** Палитра должна обнулить initial* после применения. */
  consumeInitial: () => void;
};

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(
  null,
);

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [initialQuery, setInitialQuery] = useState<string | null>(null);
  const [initialMode, setInitialMode] =
    useState<CommandPaletteInitialMode>('search');

  const open = useCallback((opts?: OpenOptions) => {
    setInitialMode(opts?.mode ?? 'search');
    setInitialQuery(opts?.initialQuery ?? null);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => setIsOpen(false), []);

  const toggle = useCallback(() => {
    setIsOpen((v) => {
      const next = !v;
      if (next) {
        setInitialMode('search');
        setInitialQuery(null);
      }
      return next;
    });
  }, []);

  const consumeInitial = useCallback(() => {
    setInitialQuery(null);
    setInitialMode('search');
  }, []);

  // Глобальный hotkey: Cmd+K (mac) / Ctrl+K (others).
  // Также реагируем на «/» когда фокус НЕ в input/textarea (как у GitHub).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const isCmdK = e.key === 'k' && (e.metaKey || e.ctrlKey);
      if (isCmdK) {
        e.preventDefault();
        setIsOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const value = useMemo<CommandPaletteContextValue>(
    () => ({
      isOpen,
      initialQuery,
      initialMode,
      open,
      close,
      toggle,
      consumeInitial,
    }),
    [isOpen, initialQuery, initialMode, open, close, toggle, consumeInitial],
  );

  return (
    <CommandPaletteContext.Provider value={value}>
      {children}
    </CommandPaletteContext.Provider>
  );
}

/**
 * Хук доступа к контексту. Безопасный fallback: если провайдер не
 * смонтирован (например, на public-страницах вне AppShell), хук вернёт
 * no-op'ы вместо throw — компонент-потребитель не упадёт.
 */
export function useCommandPalette(): CommandPaletteContextValue {
  const ctx = useContext(CommandPaletteContext);
  if (ctx) return ctx;
  return {
    isOpen: false,
    initialQuery: null,
    initialMode: 'search',
    open: () => undefined,
    close: () => undefined,
    toggle: () => undefined,
    consumeInitial: () => undefined,
  };
}
