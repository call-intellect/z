"use client";

export interface PaletteRecentAction {
  kind: "navigate" | "set-query";
  value: string;
}

export interface PaletteRecentItem {
  id: string;
  label: string;
  subtitle?: string;
  action: PaletteRecentAction;
  lastUsedAt: number;
}

const RECENT_KEY = "z:command-palette:recent";
const PINNED_KEY = "z:command-palette:pinned";
const MAX_RECENT = 10;
const MAX_PINNED = 10;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function safeParse(raw: string | null): PaletteRecentItem[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((it): it is PaletteRecentItem => {
      if (!it || typeof it !== "object") return false;
      const o = it as Record<string, unknown>;
      return (
        typeof o.id === "string" &&
        typeof o.label === "string" &&
        typeof o.lastUsedAt === "number" &&
        o.action !== null &&
        typeof o.action === "object" &&
        typeof (o.action as Record<string, unknown>).kind === "string" &&
        typeof (o.action as Record<string, unknown>).value === "string"
      );
    });
  } catch {
    return [];
  }
}

export function loadRecent(): PaletteRecentItem[] {
  if (!isBrowser()) return [];
  return safeParse(localStorage.getItem(RECENT_KEY));
}

export function loadPinned(): PaletteRecentItem[] {
  if (!isBrowser()) return [];
  return safeParse(localStorage.getItem(PINNED_KEY));
}

export function pushRecent(item: Omit<PaletteRecentItem, "lastUsedAt">): void {
  if (!isBrowser()) return;
  try {
    const now = Date.now();
    const current = loadRecent().filter((it) => it.id !== item.id);
    const next = [{ ...item, lastUsedAt: now }, ...current].slice(
      0,
      MAX_RECENT,
    );
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {}
}

export function togglePinned(item: Omit<PaletteRecentItem, "lastUsedAt">): {
  pinned: boolean;
} {
  if (!isBrowser()) return { pinned: false };
  try {
    const current = loadPinned();
    const existing = current.findIndex((it) => it.id === item.id);
    if (existing >= 0) {
      const next = current.filter((_, i) => i !== existing);
      localStorage.setItem(PINNED_KEY, JSON.stringify(next));
      return { pinned: false };
    }
    if (current.length >= MAX_PINNED) {
      return { pinned: false };
    }
    const next = [...current, { ...item, lastUsedAt: Date.now() }];
    localStorage.setItem(PINNED_KEY, JSON.stringify(next));
    return { pinned: true };
  } catch {
    return { pinned: false };
  }
}

export function isPinned(id: string): boolean {
  return loadPinned().some((it) => it.id === id);
}
