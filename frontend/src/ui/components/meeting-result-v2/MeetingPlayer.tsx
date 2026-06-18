"use client";

import { useRef } from "react";

import type { ChapterDomain } from "@/domain/chapter";
import type { HighlightDomain } from "@/domain/highlight";

export type MeetingPlayerProps = {
  videoUrl: string | null;
  durationMs: number | null;
  chapters: ChapterDomain[];
  highlights: HighlightDomain[];
  playerRef?: React.MutableRefObject<HTMLVideoElement | null>;
  onTimeUpdate?: (ms: number) => void;
  title?: string;
};

export function MeetingPlayer({
  videoUrl,
  durationMs,
  chapters,
  highlights,
  playerRef,
  onTimeUpdate,
  title,
}: MeetingPlayerProps) {
  const internalRef = useRef<HTMLVideoElement | null>(null);

  if (!videoUrl) {
    return (
      <div className="relative mx-auto aspect-video w-full max-w-[80vh] overflow-hidden rounded-xl border border-border-subtle bg-bg-card">
        <div className="grid h-full place-items-center text-center">
          <div className="px-6">
            <div className="mb-2 text-base font-medium text-fg-primary">
              Запись готовится
            </div>
            <div className="max-w-xs text-sm text-fg-secondary">
              Видео появится после обработки. Обычно занимает 2–5 минут.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative mx-auto w-full max-w-[80vh] overflow-hidden rounded-xl border border-border-subtle bg-bg-card">
      <PlayerMarkers
        chapters={chapters}
        highlights={highlights}
        durationMs={durationMs}
      />
      <video
        ref={(node) => {
          internalRef.current = node;
          if (playerRef) playerRef.current = node;
        }}
        src={videoUrl}
        controls
        preload="auto"
        playsInline
        onTimeUpdate={(e) => onTimeUpdate?.(e.currentTarget.currentTime * 1000)}
        className="aspect-video max-h-[45vh] w-full bg-black object-contain"
        aria-label={title ?? "Запись встречи"}
      />
    </div>
  );
}

function PlayerMarkers({
  chapters,
  highlights,
  durationMs,
}: {
  chapters: ChapterDomain[];
  highlights: HighlightDomain[];
  durationMs: number | null;
}) {
  if (!durationMs || durationMs <= 0) return null;
  if (chapters.length === 0 && highlights.length === 0) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 z-20 h-1.5"
    >
      {chapters.map((c) => {
        const left = Math.min(100, Math.max(0, (c.startMs / durationMs) * 100));
        return (
          <span
            key={`ch-${c.id}`}
            title={c.title}
            className="absolute top-0 h-1.5 w-[2px] rounded-sm bg-accent/60 shadow-glow-mint"
            style={{ left: `${left}%` }}
          />
        );
      })}
      {highlights.map((h) => {
        const left = Math.min(100, Math.max(0, (h.startMs / durationMs) * 100));
        return (
          <span
            key={`hl-${h.id}`}
            title={h.title}
            className="absolute top-0 h-2 w-2 -translate-x-1/2 rounded-full bg-warning shadow-[0_0_8px_rgba(251,191,36,0.6)]"
            style={{ left: `${left}%`, top: "-4px" }}
          />
        );
      })}
    </div>
  );
}
