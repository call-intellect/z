'use client';

/**
 * useIsMobile — «это мобильный экран?» поверх `useMediaQuery`.
 *
 * ТЗ 2026-06-11 mobile-cora-exec-manager, Ф1 (Б1). Граница — Tailwind `md`
 * (768px): «ниже md» = мобильная раскладка. Используем `max-width: 767.98px`,
 * чтобы gate точно зеркалил поведение классов `md:hidden`/`md:block`
 * (`md:` = `min-width: 768px`), без перекрытия на ровно 768px.
 *
 * SSR/первый рендер → `false` (см. `useMediaQuery`): viewport-gate показывает
 * нейтральный skeleton до mount, поэтому нет гидратационного скачка.
 *
 * NB: в проекте уже есть `useMediaQuery.useIsMobile` (max-width:768px), но он
 * включает ровно 768 в «мобайл» и не привязан к `md`-границе раскладки. Этот
 * хук — канон для mobile-shell gate (Б1); десктопные master-detail могут и
 * дальше использовать старый.
 */

import { useMediaQuery } from './useMediaQuery';

/** «Ниже md (768px)?» — мобильная раскладка mobile-shell. */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 767.98px)');
}
