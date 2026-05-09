import type { HighlightApi, HighlightRenderStatus } from '@/api/highlights.api';

export type HighlightDomain = {
  id: string;
  meetingId: string;
  title: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  renderStatus: HighlightRenderStatus;
  mp4Url: string | null;
  createdAt: Date;
};

export function highlightFromApi(api: HighlightApi): HighlightDomain {
  return {
    id: api.id,
    meetingId: api.meetingId,
    title: api.title,
    startMs: api.startMs,
    endMs: api.endMs,
    durationMs: api.durationMs,
    renderStatus: api.renderStatus,
    mp4Url: api.mp4Url ?? null,
    createdAt: new Date(api.createdAt),
  };
}
