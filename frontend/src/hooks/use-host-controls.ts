'use client';

import { useCallback, useState } from 'react';
import { meetingsApi } from '@/api/meetings.api';
import { ApiError } from '@/api/api-error';
import { toast } from 'sonner';
type AsyncResult<T> = { ok: true; data: T } | { ok: false; error: string };

function describeError(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Неизвестная ошибка';
}

/**
 * Все API-вызовы host-actions (mute/unmute/kick/lower-hand/finish + recording).
 * Возвращает функции, которые показывают toast при ошибке.
 */
export function useHostControls(meetingId: string) {
  const [pending, setPending] = useState<string | null>(null);

  const wrap = useCallback(
    async <T,>(
      key: string,
      fn: () => Promise<T>,
      successMsg?: string,
    ): Promise<AsyncResult<T>> => {
      setPending(key);
      try {
        const data = await fn();
        if (successMsg) toast.success(successMsg);
        return { ok: true, data };
      } catch (e) {
        const message = describeError(e);
        toast.error(message);
        return { ok: false, error: message };
      } finally {
        setPending(null);
      }
    },
    [],
  );

  return {
    pending,
    mute: (pid: string) => wrap(`mute:${pid}`, () => meetingsApi.muteParticipant(meetingId, pid)),
    unmute: (pid: string) =>
      wrap(`unmute:${pid}`, () => meetingsApi.unmuteParticipant(meetingId, pid)),
    kick: (pid: string) => wrap(`kick:${pid}`, () => meetingsApi.kickParticipant(meetingId, pid)),
    lowerHand: (pid: string) =>
      wrap(`lower:${pid}`, () => meetingsApi.lowerHand(meetingId, pid)),
    finish: () => wrap('finish', () => meetingsApi.finish(meetingId)),
    startRecording: () =>
      wrap('record-start', () => meetingsApi.startRecording(meetingId)),
    stopRecording: () =>
      wrap('record-stop', () => meetingsApi.stopRecording(meetingId)),
  };
}
