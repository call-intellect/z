import type { ChapterApi } from '@/api/chapters.api';

export type ChapterDomain = {
  id: string;
  meetingId: string;
  startMs: number;
  endMs: number;
  title: string;
  summary: string | null;
  source: 'ai' | 'manual';
  orderIndex: number;
  createdAt: Date;
  /**
   * ТЗ 2026-05-25 meeting-report-split, Фаза 6 — метка генератора.
   * Используется UI для фильтрации (fast → приоритет, v2/null → fallback).
   */
  extractorVersion: string | null;
};

export function chapterFromApi(api: ChapterApi): ChapterDomain {
  return {
    id: api.id,
    meetingId: api.meetingId,
    startMs: api.startMs,
    endMs: api.endMs,
    title: api.title,
    summary: api.summary ?? null,
    source: api.source,
    orderIndex: api.orderIndex,
    createdAt: new Date(api.createdAt),
    extractorVersion: api.extractorVersion ?? null,
  };
}

/**
 * ТЗ 2026-05-25 meeting-report-split, Фаза 6 — фильтр приоритета:
 *   - если есть хоть одна fast-глава → возвращаем только fast,
 *   - иначе возвращаем v2 + legacy (null) — как fallback.
 *
 * Используется ТОЛЬКО в пользовательском UI карточки встречи.
 * Admin compare UI продолжает показывать оба варианта рядом.
 */
export function pickPrimaryChapters(items: ChapterDomain[]): ChapterDomain[] {
  const fast = items.filter((c) => c.extractorVersion === 'fast');
  if (fast.length > 0) return fast;
  return items.filter(
    (c) => c.extractorVersion === 'v2' || c.extractorVersion === null,
  );
}
