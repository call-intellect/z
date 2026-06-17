"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type CommandPaletteInitialMode = "search" | "ai";

type OpenOptions = {
  mode?: CommandPaletteInitialMode;
  initialQuery?: string;
};

type CommandPaletteContextValue = {
  isOpen: boolean;
  initialQuery: string | null;
  initialMode: CommandPaletteInitialMode;
  open: (opts?: OpenOptions) => void;
  close: () => void;
  toggle: () => void;
  consumeInitial: () => void;
};

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(
  null,
);

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [initialQuery, setInitialQuery] = useState<string | null>(null);
  const [initialMode, setInitialMode] =
    useState<CommandPaletteInitialMode>("search");

  const open = useCallback((opts?: OpenOptions) => {
    setInitialMode(opts?.mode ?? "search");
    setInitialQuery(opts?.initialQuery ?? null);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => setIsOpen(false), []);

  const toggle = useCallback(() => {
    setIsOpen((v) => {
      const next = !v;
      if (next) {
        setInitialMode("search");
        setInitialQuery(null);
      }
      return next;
    });
  }, []);

  const consumeInitial = useCallback(() => {
    setInitialQuery(null);
    setInitialMode("search");
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const isCmdK = e.key === "k" && (e.metaKey || e.ctrlKey);
      if (isCmdK) {
        e.preventDefault();
        setIsOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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

export function useCommandPalette(): CommandPaletteContextValue {
  const ctx = useContext(CommandPaletteContext);
  if (ctx) return ctx;
  return {
    isOpen: false,
    initialQuery: null,
    initialMode: "search",
    open: () => undefined,
    close: () => undefined,
    toggle: () => undefined,
    consumeInitial: () => undefined,
  };
}
