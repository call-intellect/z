'use client';

import Link from 'next/link';
import clsx from 'clsx';

import { useToast } from '@/contexts/toast-context';
import {
  meetingDurationSeconds,
  type MeetingDomain,
} from '@/domain/meeting';
import type { MeetingStatus } from '@/domain/enums';
import { t } from '@/lib/i18n';

type Props = { meeting: MeetingDomain };

const RESULT_STATUSES: MeetingStatus[] = [
  'recording_processing',
  'recording_ready',
  'transcription_processing',
  'transcription_ready',
  'ai_processing',
  'ai_ready',
  'completed',
];

const STATUS_BADGES: Record<MeetingStatus, string> = {
  scheduled: 'bg-slate-100 text-slate-700',
  active: 'bg-emerald-100 text-emerald-800',
  completed: 'bg-slate-200 text-slate-800',
  recording_processing: 'bg-amber-100 text-amber-800',
  recording_ready: 'bg-amber-100 text-amber-800',
  transcription_processing: 'bg-blue-100 text-blue-800',
  transcription_ready: 'bg-blue-100 text-blue-800',
  ai_processing: 'bg-indigo-100 text-indigo-800',
  ai_ready: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-800',
};

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

function formatDuration(sec: number | null): string {
  if (sec === null) return '—';
  const mins = Math.round(sec / 60);
  if (mins < 1) return `<1 ${t('common.minutes')}`;
  return `${mins} ${t('common.minutes')}`;
}

export function MeetingRow({ meeting }: Props) {
  const { addToast } = useToast();
  const duration = meetingDurationSeconds(meeting);
  const targetHref = RESULT_STATUSES.includes(meeting.status)
    ? `/meetings/${meeting.id}/result`
    : `/m/${meeting.id}`;

  const copyLink = async () => {
    try {
      const url = `${window.location.origin}/m/${meeting.id}`;
      await navigator.clipboard.writeText(url);
      addToast({ type: 'success', message: t('meetings.copied') });
    } catch {
      addToast({ type: 'error', message: t('errors.unknown') });
    }
  };

  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50">
      <td className="px-3 py-3 text-sm text-slate-700">
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
          {t(`meeting_types.${meeting.type}.label`)}
        </span>
      </td>
      <td className="px-3 py-3 text-sm font-medium text-slate-900">
        <Link href={targetHref} className="hover:underline">
          {meeting.title}
        </Link>
      </td>
      <td className="px-3 py-3 text-sm text-slate-600">
        {formatDate(meeting.createdAt)}
      </td>
      <td className="px-3 py-3 text-sm text-slate-600">
        {formatDuration(duration)}
      </td>
      <td className="px-3 py-3 text-sm">
        <span
          className={clsx(
            'inline-block rounded px-2 py-0.5 text-xs font-medium',
            STATUS_BADGES[meeting.status],
          )}
        >
          {t(`meeting_status.${meeting.status}`)}
        </span>
      </td>
      <td className="px-3 py-3 text-sm">
        <div className="flex gap-2">
          <Link
            href={targetHref}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            {t('meetings.open')}
          </Link>
          <button
            type="button"
            onClick={() => {
              void copyLink();
            }}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            {t('meetings.copy_link')}
          </button>
        </div>
      </td>
    </tr>
  );
}
