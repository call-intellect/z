'use client';

import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export interface BreadcrumbOverride {
  /** Человекочитаемое имя для конечного (или указанного) звена. */
  label: string;
  /** Опц. переопределение родителя для плоских-но-вложенных маршрутов
   *  (напр. /issues/[id] → href доски проекта). Если задан — кнопка «назад»
   *  и предпоследнее звено используют его вместо URL-родителя. */
  parentHref?: string;
  /** Опц. явная метка родителя при parentHref (напр. имя проекта). */
  parentLabel?: string;
}

interface BreadcrumbContextValue {
  /** Карта override'ов: ключ — pathname маршрута, который её зарегистрировал. */
  overrides: ReadonlyMap<string, BreadcrumbOverride>;
  /** Зарегистрировать/обновить override для pathname. */
  register: (pathname: string, override: BreadcrumbOverride) => void;
  /** Снять регистрацию для pathname (вызывается при unmount страницы). */
  unregister: (pathname: string) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextValue | null>(null);

/**
 * Чтение карты override'ов из контекста. Если провайдера нет (напр. крошки
 * вне (authenticated)) — пустая карта, чтобы хук не падал.
 */
export function useBreadcrumbOverrides(): ReadonlyMap<string, BreadcrumbOverride> {
  const ctx = useContext(BreadcrumbContext);
  return ctx?.overrides ?? EMPTY_OVERRIDES;
}

const EMPTY_OVERRIDES: ReadonlyMap<string, BreadcrumbOverride> = new Map();

/**
 * Регистрирует имя/override для ТЕКУЩЕГО маршрута. Вызывается со страницы-детали,
 * которая уже загрузила сущность. Снимает регистрацию при размонтировании.
 * Пустой/undefined label или null override — no-op (пока грузится).
 */
export function useRegisterBreadcrumb(override: BreadcrumbOverride | null): void {
  const ctx = useContext(BreadcrumbContext);
  const pathname = usePathname();

  const label = override?.label?.trim() ? override.label : undefined;
  const parentHref = override?.parentHref;
  const parentLabel = override?.parentLabel;

  useEffect(() => {
    if (!ctx || !pathname || !label) return;

    ctx.register(pathname, { label, parentHref, parentLabel });

    return () => {
      ctx.unregister(pathname);
    };
  }, [ctx, pathname, label, parentHref, parentLabel]);
}

/** Провайдер вешается в AuthenticatedShell поверх AppShell. */
export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [overrides, setOverrides] = useState<Map<string, BreadcrumbOverride>>(() => new Map());

  const register = useCallback((pathname: string, override: BreadcrumbOverride) => {
    setOverrides((prev) => {
      const existing = prev.get(pathname);
      if (
        existing &&
        existing.label === override.label &&
        existing.parentHref === override.parentHref &&
        existing.parentLabel === override.parentLabel
      ) {
        return prev; // без изменений — не дёргаем ререндер
      }
      const next = new Map(prev);
      next.set(pathname, override);
      return next;
    });
  }, []);

  const unregister = useCallback((pathname: string) => {
    setOverrides((prev) => {
      if (!prev.has(pathname)) return prev;
      const next = new Map(prev);
      next.delete(pathname);
      return next;
    });
  }, []);

  const value = useMemo<BreadcrumbContextValue>(
    () => ({ overrides, register, unregister }),
    [overrides, register, unregister],
  );

  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}
