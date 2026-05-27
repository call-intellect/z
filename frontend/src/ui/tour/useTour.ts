'use client';

/**
 * Хук-инициатор тура. Вызывается на странице, где должен запуститься тур.
 *
 * Пример:
 *   ```tsx
 *   // app/(authenticated)/dashboard/page.tsx
 *   useTour('welcome');
 *   ```
 *
 * Логика:
 *   - На mount пытаемся startIfNotCompleted(tourId).
 *   - Если прогресс ещё не загружен — useEffect повторно вызовется, когда
 *     progress появится в контексте.
 *   - Если тур уже завершён/пропущен — ничего не происходит.
 */

import { useEffect } from 'react';

import { useTourContext } from './TourProvider';
import type { TourId } from './types';

export function useTour(tourId: TourId): void {
  const { startIfNotCompleted, progress } = useTourContext();

  useEffect(() => {
    // Дожидаемся загрузки прогресса. progress === null означает «ещё грузим».
    if (progress === null) return;
    startIfNotCompleted(tourId);
  }, [tourId, startIfNotCompleted, progress]);
}
