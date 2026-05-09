'use client';

import clsx from 'clsx';

import type { MeetingType } from '@/domain/enums';
import { t } from '@/lib/i18n';

type Props = {
  type: MeetingType;
  selected: boolean;
  onSelect: () => void;
};

export function MeetingTypeCard({ type, selected, onSelect }: Props) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={clsx(
        'flex flex-col items-start gap-1 rounded-md border p-4 text-left transition-colors',
        selected
          ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
      )}
    >
      <span className="text-sm font-semibold text-slate-900">
        {t(`meeting_types.${type}.label`)}
      </span>
      <span className="text-xs text-slate-600">
        {t(`meeting_types.${type}.description`)}
      </span>
    </button>
  );
}
