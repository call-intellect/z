'use client';

import clsx from 'clsx';

import type { MeetingStatus } from '@/domain/enums';
import { t } from '@/lib/i18n';

type Stage = 'recording' | 'transcribing' | 'analyzing' | 'ready';

const STAGES: Stage[] = ['recording', 'transcribing', 'analyzing', 'ready'];

function statusToStage(status: MeetingStatus): Stage {
  switch (status) {
    case 'active':
    case 'completed':
    case 'recording_processing':
      return 'recording';
    case 'recording_ready':
    case 'transcription_processing':
      return 'transcribing';
    case 'transcription_ready':
    case 'ai_processing':
      return 'analyzing';
    case 'ai_ready':
      return 'ready';
    default:
      return 'recording';
  }
}

export function ProgressState({ status }: { status: MeetingStatus }) {
  const current = statusToStage(status);
  const currentIndex = STAGES.indexOf(current);

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-center text-xl font-semibold text-slate-900">
        {t('result.progress_title')}
      </h2>
      <ol className="flex items-center justify-between gap-2">
        {STAGES.map((stage, idx) => {
          const isDone = idx < currentIndex;
          const isCurrent = idx === currentIndex;
          return (
            <li
              key={stage}
              className="flex flex-1 flex-col items-center gap-2"
              aria-current={isCurrent ? 'step' : undefined}
            >
              <div
                className={clsx(
                  'flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold',
                  isDone && 'bg-emerald-500 text-white',
                  isCurrent && 'bg-blue-600 text-white animate-pulse',
                  !isDone && !isCurrent && 'bg-slate-200 text-slate-500',
                )}
              >
                {isDone ? '✓' : idx + 1}
              </div>
              <span
                className={clsx(
                  'text-center text-xs',
                  isCurrent ? 'font-semibold text-slate-900' : 'text-slate-600',
                )}
              >
                {t(`result.progress.${stage}`)}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
