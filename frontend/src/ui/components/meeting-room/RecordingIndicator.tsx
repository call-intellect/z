'use client';

import clsx from 'clsx';
import { t } from '@/lib/i18n';

type Props = {
  active: boolean;
};

export function RecordingIndicator({ active }: Props) {
  if (!active) return null;
  return (
    <div
      role="status"
      aria-label={t('room.recording_indicator')}
      className={clsx(
        'inline-flex items-center gap-2 rounded-full bg-red-600/95 px-3 py-1 text-xs font-medium text-white shadow',
      )}
    >
      <span className="relative inline-block h-2 w-2">
        <span className="absolute inset-0 animate-ping rounded-full bg-white/70" />
        <span className="relative inline-block h-2 w-2 rounded-full bg-white" />
      </span>
      <span>{t('room.recording_indicator')}</span>
    </div>
  );
}
