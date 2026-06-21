"use client";

import { useCallback, useEffect, useState } from "react";

export type CardDensity = "compact" | "wide";

const STORAGE_KEY = "tracker.cardDensity";

export function useCardDensity(): {
  density: CardDensity;
  setDensity: (next: CardDensity) => void;
  compact: boolean;
} {
  const [density, setDensityState] = useState<CardDensity>("compact");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "compact" || saved === "wide") setDensityState(saved);
    } catch {}
  }, []);

  const setDensity = useCallback((next: CardDensity) => {
    setDensityState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  }, []);

  return { density, setDensity, compact: density === "compact" };
}
