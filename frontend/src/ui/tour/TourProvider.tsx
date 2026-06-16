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
import { toast } from "sonner";

import {
  tourProgressApi,
  type TourProgressApi,
} from "@/api/users/tour-progress.api";
import { useTourProgress } from "@/hooks/useTourProgress";

import { TourOverlay } from "./TourOverlay";
import { TOUR_REGISTRY } from "./tours";
import type { TourDefinition, TourId } from "./types";

interface ActiveTour {
  definition: TourDefinition;
  stepIndex: number;
}

interface TourContextValue {
  progress: TourProgressApi | null;
  active: ActiveTour | null;
  startIfNotCompleted: (tourId: TourId) => void;
  forceStart: (tourId: TourId) => void;
  complete: () => Promise<void>;
  skip: () => Promise<void>;
  next: () => void;
  prev: () => void;
  resetAll: () => Promise<void>;
}

const TourContext = createContext<TourContextValue | null>(null);

function isTourDone(progress: TourProgressApi | null, tourId: TourId): boolean {
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
      if (active !== null) return;
      if (progress === null) return;
      if (isTourDone(progress, tourId)) return;
      const def = TOUR_REGISTRY[tourId];
      setActive({ definition: def, stepIndex: 0 });
      tourProgressApi
        .update({ tourId })
        .then((next) => mutate(next))
        .catch(() => {});
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
      toast.error("Не удалось сохранить прогресс тура.");
    }
  }, [active, mutate, progress]);

  const skip = useCallback(async () => {
    if (!active) return;
    const tourId = active.definition.id;
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
      toast.error("Не удалось сохранить пропуск тура.");
    }
  }, [active, mutate, progress]);

  const next = useCallback(() => {
    setActive((cur) => {
      if (!cur) return cur;
      const lastIndex = cur.definition.steps.length - 1;
      if (cur.stepIndex >= lastIndex) {
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
    throw new Error("useTourContext must be used inside <TourProvider>");
  }
  return ctx;
}

export function useTourContextOptional(): TourContextValue | null {
  return useContext(TourContext);
}
