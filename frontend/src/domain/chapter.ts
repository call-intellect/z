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
  };
}
