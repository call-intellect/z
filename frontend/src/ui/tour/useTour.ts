"use client";

import { useEffect } from "react";

import { useTourContext } from "./TourProvider";
import type { TourId } from "./types";

export function useTour(tourId: TourId): void {
  const { startIfNotCompleted, progress } = useTourContext();

  useEffect(() => {
    if (progress === null) return;
    startIfNotCompleted(tourId);
  }, [tourId, startIfNotCompleted, progress]);
}
