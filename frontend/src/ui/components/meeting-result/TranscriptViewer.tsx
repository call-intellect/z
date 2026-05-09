'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

import { meetingsApi } from '@/api/meetings.api';
import { ApiError } from '@/api/api-error';
import { Skeleton } from '@/ui/components/shared/Skeleton';
import { ErrorState } from '@/ui/components/shared/ErrorState';
import { EmptyState } from '@/ui/components/shared/EmptyState';
import { t } from '@/lib/i18n';

type TranscriptCue = {
  speaker: string | null;
  text: string;
  start: number; // seconds
  end: number;
};

type Props = {
  meetingId: string;
  videoRef: RefObject<HTMLVideoElement>;
};

type State =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; cues: TranscriptCue[] };

function parseCues(raw: unknown): TranscriptCue[] {
  if (!Array.isArray(raw)) return [];
  const cues: TranscriptCue[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const obj = item as Record<string, unknown>;
    const text = typeof obj.text === 'string' ? obj.text : null;
    const start =
      typeof obj.start === 'number'
        ? obj.start
        : typeof obj.start_time === 'number'
          ? obj.start_time
          : null;
    if (!text || start === null) continue;
    const end =
      typeof obj.end === 'number'
        ? obj.end
        : typeof obj.end_time === 'number'
          ? obj.end_time
          : start;
    const speaker =
      typeof obj.speaker === 'string'
        ? obj.speaker
        : typeof obj.participant === 'string'
          ? obj.participant
          : typeof obj.name === 'string'
            ? obj.name
            : null;
    cues.push({ speaker, text, start, end });
  }
  return cues;
}

function formatTimestamp(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function TranscriptViewer({ meetingId, videoRef }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const cancelledRef = useRef(false);

  const load = () => {
    cancelledRef.current = false;
    setState({ kind: 'loading' });
    (async () => {
      try {
        const meta = await meetingsApi.transcript(meetingId);
        const res = await fetch(meta.url);
        if (!res.ok) {
          throw new Error(`Не удалось загрузить стенограмму (HTTP ${res.status}).`);
        }
        const json = (await res.json()) as unknown;
        if (cancelledRef.current) return;
        const cues = parseCues(json);
        if (cues.length === 0) {
          setState({ kind: 'empty' });
        } else {
          setState({ kind: 'ready', cues });
        }
      } catch (e) {
        if (cancelledRef.current) return;
        const message =
          e instanceof ApiError
            ? e.message
            : e instanceof Error
              ? e.message
              : t('errors.unknown');
        setState({ kind: 'error', message });
      }
    })();
  };

  useEffect(() => {
    load();
    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  const seek = (sec: number) => {
    const v = videoRef.current;
    if (!v) return;
    try {
      v.currentTime = sec;
      void v.play();
    } catch {
      // ignore — некоторые браузеры могут отказать
    }
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-3 text-lg font-semibold text-slate-900">
        {t('result.transcript')}
      </h2>
      {state.kind === 'loading' ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      ) : state.kind === 'error' ? (
        <ErrorState message={state.message} onRetry={load} />
      ) : state.kind === 'empty' ? (
        <EmptyState title={t('result.transcript_empty')} />
      ) : (
        <ol className="flex flex-col gap-3">
          {state.cues.map((cue, idx) => (
            <li
              key={idx}
              className="flex gap-3 rounded border border-slate-100 bg-slate-50 p-3"
            >
              <button
                type="button"
                onClick={() => seek(cue.start)}
                className="font-mono text-xs text-blue-700 hover:text-blue-900 hover:underline"
              >
                {formatTimestamp(cue.start)}
              </button>
              <div className="flex-1">
                {cue.speaker ? (
                  <p className="mb-0.5 text-xs font-semibold text-slate-700">
                    {cue.speaker}
                  </p>
                ) : null}
                <p className="text-sm text-slate-800">{cue.text}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
