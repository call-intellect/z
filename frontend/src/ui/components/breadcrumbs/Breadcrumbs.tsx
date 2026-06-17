'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/shadcn/dropdown-menu';

import { useBreadcrumbTrail, type BreadcrumbItem } from './useBreadcrumbTrail';

/**
 * Breadcrumbs — хлебные крошки кабинета (десктоп top-bar).
 *
 * Рендерит `useBreadcrumbTrail()`. Стиль выровнен с админскими
 * `AdminBreadcrumbs`. Правила (ТЗ 2026-06-17 §4):
 *  - `trail.length < 2` → ничего не рендерим (null).
 *  - звено с `isLoading` → скелетон вместо текста.
 *  - `trail.length >= 5` → сворачивание: первое › … › предпоследнее › текущее,
 *    «…» это DropdownMenu со скрытыми средними звеньями.
 *  - `trail.length < 5` → все звенья подряд.
 */
const SEPARATOR = (
  <ChevronRight size={12} className="text-fg-tertiary/60" aria-hidden />
);

function LinkLabel({ item }: { item: BreadcrumbItem }) {
  if (item.isLoading) {
    return (
      <span className="inline-block h-3 w-16 animate-pulse rounded bg-bg-overlay" />
    );
  }
  return <>{item.label}</>;
}

/** Кликабельное / текущее / некликабельное звено (без разделителя). */
function Crumb({ item }: { item: BreadcrumbItem }) {
  if (item.href && !item.isCurrent) {
    return (
      <Link
        href={item.href}
        className="rounded-sm px-1 py-0.5 transition-colors hover:bg-bg-overlay hover:text-fg-primary"
      >
        <LinkLabel item={item} />
      </Link>
    );
  }
  return (
    <span
      aria-current={item.isCurrent ? 'page' : undefined}
      className={item.isCurrent ? 'px-1 py-0.5 font-medium text-fg-secondary' : 'px-1 py-0.5'}
    >
      <LinkLabel item={item} />
    </span>
  );
}

export function Breadcrumbs() {
  const trail = useBreadcrumbTrail();

  if (trail.length < 2) return null;

  // При большом пути сворачиваем середину в выпадающее меню «…».
  const collapse = trail.length >= 5;
  const first = trail[0];
  const middle = collapse ? trail.slice(1, trail.length - 2) : [];
  const tail = collapse ? trail.slice(trail.length - 2) : trail.slice(1);

  return (
    <nav
      aria-label="Хлебные крошки"
      className="flex flex-wrap items-center gap-1 text-xs text-fg-tertiary"
    >
      {collapse ? (
        <>
          <span className="inline-flex items-center gap-1">
            <Crumb item={first} />
            {SEPARATOR}
          </span>
          <span className="inline-flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Показать промежуточные крошки"
                className="rounded-sm px-1 py-0.5 transition-colors hover:bg-bg-overlay hover:text-fg-primary"
              >
                …
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {middle.map((item, idx) => (
                  <DropdownMenuItem key={`${item.label}-${idx}`} asChild>
                    {item.href ? (
                      <Link href={item.href}>{item.label}</Link>
                    ) : (
                      <span>{item.label}</span>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {SEPARATOR}
          </span>
          {tail.map((item, idx) => {
            const isLast = idx === tail.length - 1;
            return (
              <span key={`${item.label}-${idx}`} className="inline-flex items-center gap-1">
                <Crumb item={item} />
                {isLast ? null : SEPARATOR}
              </span>
            );
          })}
        </>
      ) : (
        <>
          <span className="inline-flex items-center gap-1">
            <Crumb item={first} />
            {tail.length > 0 ? SEPARATOR : null}
          </span>
          {tail.map((item, idx) => {
            const isLast = idx === tail.length - 1;
            return (
              <span key={`${item.label}-${idx}`} className="inline-flex items-center gap-1">
                <Crumb item={item} />
                {isLast ? null : SEPARATOR}
              </span>
            );
          })}
        </>
      )}
    </nav>
  );
}
