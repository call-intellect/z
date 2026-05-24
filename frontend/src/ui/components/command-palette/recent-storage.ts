'use client';

/**
 * Локальный реестр «Недавнее» и «Закреплённое» для командной палитры
 * (Wave 2 finishing — задача 4 из polish-набора).
 *
 * Хранится в localStorage пользователя (per-browser, не per-org).
 * Структура:
 *   - `z:command-palette:recent`  → массив записей, отсортированных по
 *     убыванию `lastUsedAt`. Max 10 элементов, при переполнении старые
 *     вытесняются.
 *   - `z:command-palette:pinned`  → массив записей, ручной порядок
 *     (порядок добавления, max 10).
 *
 * `action.kind` — дискриминатор: `navigate` (просто go(href)) или `set-query`
 * (превратить ввод в `?` / `>` префиксированный шаблон). Этого достаточно
 * для типичных кейсов; в будущем — добавить runConcierge с зафиксированным
 * текстом.
 */

export interface PaletteRecentAction {
  /** Тип действия, которое будет выполнено при выборе записи. */
  kind: 'navigate' | 'set-query';
  /** Для navigate — путь, для set-query — что положить в инпут. */
  value: string;
}

export interface PaletteRecentItem {
  /** Стабильный id для дедупликации (например `nav:/projects`). */
  id: string;
  /** Подпись для пользователя. */
  label: string;
  /** Подзаголовок (опц.). */
  subtitle?: string;
  /** Что делать при клике. */
  action: PaletteRecentAction;
  /** Время последнего использования (ms). */
  lastUsedAt: number;
}

const RECENT_KEY = 'z:command-palette:recent';
const PINNED_KEY = 'z:command-palette:pinned';
const MAX_RECENT = 10;
const MAX_PINNED = 10;

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function safeParse(raw: string | null): PaletteRecentItem[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Минимальная валидация — не доверяем тому, что положили старые версии.
    return parsed.filter((it): it is PaletteRecentItem => {
      if (!it || typeof it !== 'object') return false;
      const o = it as Record<string, unknown>;
      return (
        typeof o.id === 'string' &&
        typeof o.label === 'string' &&
        typeof o.lastUsedAt === 'number' &&
        o.action !== null &&
        typeof o.action === 'object' &&
        typeof (o.action as Record<string, unknown>).kind === 'string' &&
        typeof (o.action as Record<string, unknown>).value === 'string'
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

/** Положить запись в Recent: поднимает наверх, дедуп по id, обрезает по MAX. */
export function pushRecent(item: Omit<PaletteRecentItem, 'lastUsedAt'>): void {
  if (!isBrowser()) return;
  try {
    const now = Date.now();
    const current = loadRecent().filter((it) => it.id !== item.id);
    const next = [{ ...item, lastUsedAt: now }, ...current].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Quota / disabled storage — silently skip, фича не критичная.
  }
}

export function togglePinned(item: Omit<PaletteRecentItem, 'lastUsedAt'>): {
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
      // Заполнено — не добавляем, чтобы не выгонять чужой выбор молча.
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
