'use client';

import clsx from 'clsx';
import { useRaiseHand } from '@/hooks/use-raise-hand';
import { t } from '@/lib/i18n';

export function RaiseHandButton() {
  const { isRaised, toggle } = useRaiseHand();

  return (
    <button
      type="button"
      onClick={() => { void toggle(); }}
      aria-pressed={isRaised}
      className={clsx(
        'flex flex-col items-center gap-1 rounded-xl px-3 py-2 text-[10px] font-medium transition-colors',
        isRaised ? 'bg-warning text-warning-fg hover:opacity-90' : 'bg-bg-overlay text-fg-primary hover:bg-bg-overlay/80',
      )}
    >
      <span aria-hidden="true" className="text-lg leading-none">✋</span>
      <span>{isRaised ? t('room.controls.lower_hand') : t('room.controls.raise_hand')}</span>
    </button>
  );
}
