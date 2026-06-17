'use client';

import { usePathname } from 'next/navigation';

import {
  DYNAMIC_FALLBACK_BY_PARENT,
  NON_NAVIGABLE_SEGMENTS,
  SEGMENT_LABELS,
} from './breadcrumb-config';
import { useBreadcrumbOverrides, type BreadcrumbOverride } from './BreadcrumbContext';

export interface BreadcrumbItem {
  label: string;
  href?: string; // отсутствует у текущего (последнего) звена и у non-navigable
  isCurrent: boolean;
  isLoading?: boolean; // динамический лист, имя ещё не зарегистрировано
}

/**
 * Чистая функция-ядро (юнит-тестируется без React): pathname + реестры +
 * карта override → массив звеньев.
 *
 * Алгоритм:
 * 1. Разбить pathname на сегменты (отбросить пустые).
 * 2. Накопительный href на каждом шаге (/projects, /projects/vkhod, …).
 * 3. Метка звена по приоритету: override.label → SEGMENT_LABELS[segment] →
 *    DYNAMIC_FALLBACK_BY_PARENT[предыдущийСтатическийСегмент] (isLoading) →
 *    пропуск (служебный сегмент).
 * 4. href у всех кроме последнего (isCurrent) и кроме NON_NAVIGABLE_SEGMENTS.
 * 5. Если у текущего pathname задан parentHref-override — предпоследнее звено
 *    замещается на { label: parentLabel ?? метка, href: parentHref }, URL-родитель
 *    не строится (кейс /issues/[id]).
 */
export function buildBreadcrumbTrail(
  pathname: string,
  overrides: ReadonlyMap<string, BreadcrumbOverride>,
): BreadcrumbItem[] {
  const segments = pathname.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return [];

  const items: BreadcrumbItem[] = [];
  let accumulatedHref = '';
  let prevSegment: string | null = null;

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    accumulatedHref += `/${segment}`;
    const isLast = i === segments.length - 1;

    const override = overrides.get(accumulatedHref);

    let label: string | undefined;
    let isLoading = false;

    if (override?.label) {
      label = override.label;
    } else if (SEGMENT_LABELS[segment]) {
      label = SEGMENT_LABELS[segment];
    } else if (prevSegment && DYNAMIC_FALLBACK_BY_PARENT[prevSegment]) {
      // динамический сегмент (id/slug): имя ещё не зарегистрировано → метка типа
      label = DYNAMIC_FALLBACK_BY_PARENT[prevSegment];
      isLoading = true;
    } else {
      // служебный/неизвестный сегмент — пропускаем, но контекст родителя двигаем
      prevSegment = segment;
      continue;
    }

    const navigable = !isLast && !NON_NAVIGABLE_SEGMENTS.has(segment);

    items.push({
      label,
      href: navigable ? accumulatedHref : undefined,
      isCurrent: isLast,
      ...(isLoading ? { isLoading: true } : {}),
    });

    prevSegment = segment;
  }

  // parentHref-override: для плоских-но-вложенных маршрутов (/issues/[id]) —
  // замещаем предпоследнее звено родителем из override, не строим URL-родителя.
  const leafOverride = overrides.get(pathname);
  if (leafOverride?.parentHref && items.length >= 2) {
    const parentLabel = leafOverride.parentLabel ?? items[items.length - 2].label;
    items[items.length - 2] = {
      label: parentLabel,
      href: leafOverride.parentHref,
      isCurrent: false,
    };
  }

  return items;
}

/** React-обёртка: usePathname() + чтение карты override из контекста. */
export function useBreadcrumbTrail(): BreadcrumbItem[] {
  const pathname = usePathname();
  const overrides = useBreadcrumbOverrides();
  return buildBreadcrumbTrail(pathname ?? '', overrides);
}
