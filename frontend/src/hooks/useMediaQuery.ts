'use client';

/**
 * useMediaQuery — простой хук на window.matchMedia + useEffect.
 *
 * Используется для условного рендеринга компонентов в зависимости от ширины
 * вьюпорта (mobile vs desktop master-detail и т. п.). Без сторонних
 * зависимостей.
 *
 * На SSR/первом рендере возвращает `false`, чтобы избежать гидратационных
 * рассинхронов: фактическое значение применяется после mount.
 */

import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    // Safari < 14 не поддерживает addEventListener на MQL — fallback на addListener.
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, [query]);

  return matches;
}

/** Удобный шорткат: «это мобайл?» — viewport ≤ 768px. */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 768px)');
}
