'use client';

import clsx from 'clsx';

import { useRaiseHand } from '@/hooks/use-raise-hand';
import { t } from '@/lib/i18n';

export function RaiseHandButton() {
  const { isRaised, toggle } = useRaiseHand();
  const label = isRaised ? t('room.controls.lower_hand') : t('room.controls.raise_hand');

  return (
    <button
      type="button"
      onClick={() => {
        void toggle();
      }}
      aria-pressed={isRaised}
      title={label}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        isRaised
          ? 'bg-amber-500 text-white hover:bg-amber-600'
          : 'bg-slate-700 text-white hover:bg-slate-600',
      )}
    >
      <span aria-hidden="true">{isRaised ? '✋' : '✋'}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
