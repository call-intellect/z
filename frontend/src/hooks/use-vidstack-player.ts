'use client';

import { useCallback, useRef } from 'react';
import type { MediaPlayerInstance } from '@vidstack/react';

/**
 * Маленькая обёртка над `MediaPlayerInstance` ref от Vidstack.
 * Возвращает `playerRef` (для биндинга <MediaPlayer ref={playerRef}>) и
 * императивные хелперы — `seekTo(ms)`, `play()`, `pause()`, `togglePlay()`.
 */
export function useVidstackPlayer() {
  const playerRef = useRef<MediaPlayerInstance | null>(null);

  const seekTo = useCallback((ms: number) => {
    const p = playerRef.current;
    if (!p) return;
    const seconds = Math.max(0, ms / 1000);
    p.currentTime = seconds;
  }, []);

  const play = useCallback(async () => {
    await playerRef.current?.play().catch(() => undefined);
  }, []);

  const pause = useCallback(() => {
    playerRef.current?.pause();
  }, []);

  const togglePlay = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (p.paused) {
      void p.play().catch(() => undefined);
    } else {
      p.pause();
    }
  }, []);

  return { playerRef, seekTo, play, pause, togglePlay };
}

export type VidstackPlayerControls = ReturnType<typeof useVidstackPlayer>;
