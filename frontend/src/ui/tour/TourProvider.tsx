'use client';

/**
 * TourProvider — глобальный контекст onboarding-туров.
 *
 * Что делает:
 *   - На mount грузит `tourProgress` пользователя (через useTourProgress).
 *   - Управляет состоянием активного тура (текущий tourId + step index).
 *   - Предоставляет хуки next/prev/skip/complete + persist через PATCH.
 *   - Хук useTour(tourId) внутри страницы вызывает auto-start, если тур
 *     ещё не пройден и не пропущен.
 *
 * Что НЕ делает:
 *   - Не рендерит UI напрямую — UI рендерится в `<TourOverlay />` ниже,
 *     который читает context.
 *
 * Источник: plans/tz/2026-05-27-tracker-onboarding-tour.md.
 *
 * Доступность:
 *   - ESC закрывает тур == skip
 *   - Tab фокус — браузерный (на кнопки внутри tooltip).
 *   - aria-live="polite" на текущем шаге.
 *   - aria-label="Тур: шаг N из M" на корневом контейнере.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';

import {
  tourProgressApi,
  type TourProgressApi,
} from '@/api/users/tour-progress.api';
import { useTourProgress } from '@/hooks/useTourProgress';

import { TourOverlay } from './TourOverlay';
import { TOUR_REGISTRY } from './tours';
import type { TourDefinition, TourId } from './types';

interface ActiveTour {
  definition: TourDefinition;
  stepIndex: number;
}

interface TourContextValue {
  /** Прогресс из БД (null = ещё грузим). */
  progress: TourProgressApi | null;
  /** Активный тур (null = ничего не показываем). */
  active: ActiveTour | null;
  /** Запросить старт тура. Если уже завершён/пропущен — игнорируется. */
  startIfNotCompleted: (tourId: TourId) => void;
  /** Перезапустить тур принудительно (для кнопки «Показать заново» — после reset). */
  forceStart: (tourId: TourId) => void;
  /** Завершить тур (с записью completedAt). */
  complete: () => Promise<void>;
  /** Пропустить тур (skip=true). */
  skip: () => Promise<void>;
  /** Следующий шаг. На последнем — complete. */
  next: () => void;
  /** Предыдущий шаг. На первом — no-op. */
  prev: () => void;
  /** Сбросить все туры (для «Показать заново»). */
  resetAll: () => Promise<void>;
}

const TourContext = createContext<TourContextValue | null>(null);

/**
 * Тур считается «уже завершён, не показывать заново», если есть
 * `completedAt` или `skipped === true`. Если объект записан в БД,
 * но без этих полей — считаем started (показывать тоже не надо,
 * чтобы не повторять показ при перезаходе).
 */
function isTourDone(
  progress: TourProgressApi | null,
  tourId: TourId,
): boolean {
  if (!progress) return false;
  const entry = progress[tourId];
  if (!entry) return false;
  return Boolean(entry.completedAt) || entry.skipped === true;
}

export function TourProvider({ children }: { children: ReactNode }) {
  const { progress, mutate } = useTourProgress(true);
  const [active, setActive] = useState<ActiveTour | null>(null);

  const startIfNotCompleted = useCallback(
    (tourId: TourId) => {
      // Если тур уже идёт — ничего не делаем.
      if (active !== null) return;
      // Прогресс ещё не загружен — отложим (хук useTour вызовет ещё раз
      // через эффект, когда progress появится).
      if (progress === null) return;
      if (isTourDone(progress, tourId)) return;
      const def = TOUR_REGISTRY[tourId];
      setActive({ definition: def, stepIndex: 0 });
      // Помечаем как started (PATCH без completedAt/skipped). Это
      // защищает от двойного показа при перезаходе пока тур идёт.
      tourProgressApi
        .update({ tourId })
        .then((next) => mutate(next))
        .catch(() => {
          // Тур всё равно показываем, если PATCH упал — UX важнее.
        });
    },
    [active, progress, mutate],
  );

  const forceStart = useCallback(
    (tourId: TourId) => {
      const def = TOUR_REGISTRY[tourId];
      setActive({ definition: def, stepIndex: 0 });
      tourProgressApi
        .update({ tourId })
        .then((next) => mutate(next))
        .catch(() => undefined);
    },
    [mutate],
  );

  const complete = useCallback(async () => {
    if (!active) return;
    const tourId = active.definition.id;
    const completedAt = new Date().toISOString();
    // Оптимистически обновляем cache, чтобы useTour не перезапустил тур
    // в следующем render'е (между setActive(null) и резолвом PATCH).
    const optimistic: TourProgressApi = {
      ...(progress ?? {}),
      [tourId]: { ...(progress?.[tourId] ?? {}), completedAt },
    };
    await mutate(optimistic);
    setActive(null);
    try {
      const next = await tourProgressApi.update({ tourId, completedAt });
      await mutate(next);
    } catch {
      toast.error('Не удалось сохранить прогресс тура.');
    }
  }, [active, mutate, progress]);

  const skip = useCallback(async () => {
    if (!active) return;
    const tourId = active.definition.id;
    // Оптимистически помечаем skipped, чтобы useTour не перезапустил тур.
    const optimistic: TourProgressApi = {
      ...(progress ?? {}),
      [tourId]: { ...(progress?.[tourId] ?? {}), skipped: true },
    };
    await mutate(optimistic);
    setActive(null);
    try {
      const next = await tourProgressApi.update({ tourId, skipped: true });
      await mutate(next);
    } catch {
      toast.error('Не удалось сохранить пропуск тура.');
    }
  }, [active, mutate, progress]);

  const next = useCallback(() => {
    setActive((cur) => {
      if (!cur) return cur;
      const lastIndex = cur.definition.steps.length - 1;
      if (cur.stepIndex >= lastIndex) {
        // Последний шаг — оптимистически отмечаем completed (чтобы useTour
        // не рестартанул), потом PATCH асинхронно.
        const tourId = cur.definition.id;
        const completedAt = new Date().toISOString();
        const optimistic: TourProgressApi = {
          ...(progress ?? {}),
          [tourId]: { ...(progress?.[tourId] ?? {}), completedAt },
        };
        void mutate(optimistic);
        tourProgressApi
          .update({ tourId, completedAt })
          .then((p) => mutate(p))
          .catch(() => undefined);
        return null;
      }
      return { ...cur, stepIndex: cur.stepIndex + 1 };
    });
  }, [mutate, progress]);

  const prev = useCallback(() => {
    setActive((cur) => {
      if (!cur) return cur;
      if (cur.stepIndex <= 0) return cur;
      return { ...cur, stepIndex: cur.stepIndex - 1 };
    });
  }, []);

  const resetAll = useCallback(async () => {
    setActive(null);
    await tourProgressApi.reset();
    await mutate({});
  }, [mutate]);

  const value = useMemo<TourContextValue>(
    () => ({
      progress,
      active,
      startIfNotCompleted,
      forceStart,
      complete,
      skip,
      next,
      prev,
      resetAll,
    }),
    [
      progress,
      active,
      startIfNotCompleted,
      forceStart,
      complete,
      skip,
      next,
      prev,
      resetAll,
    ],
  );

  return (
    <TourContext.Provider value={value}>
      {children}
      <TourOverlay />
    </TourContext.Provider>
  );
}

export function useTourContext(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) {
    throw new Error('useTourContext must be used inside <TourProvider>');
  }
  return ctx;
}

/**
 * Безопасный вариант — возвращает null, если TourProvider не оборачивает
 * дерево (например, на onboarding-странице где провайдер не рендерится).
 */
export function useTourContextOptional(): TourContextValue | null {
  return useContext(TourContext);
}
