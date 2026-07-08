"use client";

import { useEffect, useRef } from "react";

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();

function subscribe(key: string, fn: Listener): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(fn);
  return () => {
    set?.delete(fn);
    if (set && set.size === 0) listeners.delete(key);
  };
}

function emit(key: string): void {
  const set = listeners.get(key);
  if (!set) return;
  for (const fn of set) fn();
}

export function notifyCatalogChange(key: CatalogRefreshKey): void {
  emit(key);
  emit("all");
}

export function useCatalogRefresh(
  key: CatalogRefreshKey | "all",
  onRefresh: () => void,
): void {
  const ref = useRef(onRefresh);
  ref.current = onRefresh;
  useEffect(() => {
    return subscribe(key, () => ref.current());
  }, [key]);
}

export type CatalogRefreshKey =
  | "providers"
  | "models"
  | "prices"
  | "smoke";
