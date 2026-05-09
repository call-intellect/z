'use client';

import { forwardRef, type ForwardedRef } from 'react';

type Props = {
  src: string;
};

/**
 * Простой `<video controls>` с контролами браузера. Ref пробрасываем
 * наружу — `TranscriptViewer` использует `ref.current.currentTime = sec`
 * для seek по тайм-кодам.
 */
export const VideoPlayer = forwardRef<HTMLVideoElement, Props>(
  function VideoPlayer({ src }: Props, ref: ForwardedRef<HTMLVideoElement>) {
    return (
      <video
        ref={ref}
        src={src}
        controls
        preload="metadata"
        className="w-full rounded-lg border border-slate-200 bg-black shadow-sm"
      />
    );
  },
);
