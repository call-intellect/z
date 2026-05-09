'use client';

/**
 * Vidstack-плеер встречи. Кастомизирован под mint-акцент Z.
 *
 * Источник видео: presigned URL из `meeting.recording.mainVideoUrl`.
 * Если запись не готова — placeholder.
 *
 * Маркеры:
 *   - Главы: вертикальные mint-glow линии в `chapter.startMs`.
 *   - Highlights: золотые точки в `highlight.startMs`.
 */

import { useEffect, useRef } from 'react';
import {
  MediaPlayer,
  MediaProvider,
  type MediaPlayerInstance,
} from '@vidstack/react';
import {
  defaultLayoutIcons,
  DefaultVideoLayout,
} from '@vidstack/react/player/layouts/default';

import type { ChapterDomain } from '@/domain/chapter';
import type { HighlightDomain } from '@/domain/highlight';

export type MeetingPlayerProps = {
  /** Presigned URL основной видеозаписи (или null если не готово). */
  videoUrl: string | null;
  /** Длительность записи в миллисекундах для расчёта позиций маркеров. */
  durationMs: number | null;
  /** Главы для рендера маркеров. */
  chapters: ChapterDomain[];
  /** Хайлайты для рендера маркеров. */
  highlights: HighlightDomain[];
  /** Ref на инстанс плеера (см. `useVidstackPlayer`). */
  playerRef?: React.MutableRefObject<MediaPlayerInstance | null>;
  /** Колбэк при изменении текущей позиции воспроизведения. */
  onTimeUpdate?: (ms: number) => void;
  /** Заголовок встречи (для accessibility). */
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
  const internalRef = useRef<MediaPlayerInstance | null>(null);

  // Подписка на time-updates через onTimeUpdate prop
  useEffect(() => {
    const player = playerRef?.current ?? internalRef.current;
    if (!player || !onTimeUpdate) return;
    const off = player.subscribe(({ currentTime }) => {
      onTimeUpdate(currentTime * 1000);
    });
    return off;
  }, [onTimeUpdate, playerRef]);

  if (!videoUrl) {
    return (
      <div className="relative aspect-video overflow-hidden rounded-xl border border-border-subtle bg-bg-card">
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
    <div className="relative overflow-hidden rounded-xl border border-border-subtle bg-bg-card">
      <MediaPlayer
        ref={(node) => {
          internalRef.current = node;
          if (playerRef) playerRef.current = node;
        }}
        title={title ?? 'Запись встречи'}
        src={videoUrl}
        playsInline
        className="aspect-video w-full"
      >
        <MediaProvider />
        <DefaultVideoLayout icons={defaultLayoutIcons} />
        {/* Кастомные маркеры на таймлайне */}
        <PlayerMarkers
          chapters={chapters}
          highlights={highlights}
          durationMs={durationMs}
        />
      </MediaPlayer>
    </div>
  );
}

/**
 * Накладывает маркеры (главы + highlights) поверх Vidstack-таймлайна.
 * Используется position:absolute с z-index выше дефолтного контролл-бара.
 */
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
      className="pointer-events-none absolute inset-x-3 bottom-[60px] z-20 h-1.5"
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
            style={{ left: `${left}%`, top: '-4px' }}
          />
        );
      })}
    </div>
  );
}
