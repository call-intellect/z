'use client';

import { useCallback, useRef } from 'react';

/**
 * Обёртка над нативным `<video>` (`HTMLVideoElement`). Заменила Vidstack-хук:
 * Vidstack web-компонент не инициализировался в prod-сборке. Возвращает
 * `playerRef` (биндить в `<video ref={playerRef}>`) + императивные хелперы.
 */
export function useVideoPlayer() {
  const playerRef = useRef<HTMLVideoElement | null>(null);

  const seekTo = useCallback((ms: number) => {
    const el = playerRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, ms / 1000);
  }, []);

  const play = useCallback(async () => {
    await playerRef.current?.play().catch(() => undefined);
  }, []);

  const pause = useCallback(() => {
    playerRef.current?.pause();
  }, []);

  const togglePlay = useCallback(() => {
    const el = playerRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  }, []);

  return { playerRef, seekTo, play, pause, togglePlay };
}

export type VideoPlayerControls = ReturnType<typeof useVideoPlayer>;
