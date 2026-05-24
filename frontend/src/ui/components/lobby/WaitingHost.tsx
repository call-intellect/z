'use client';

import { t } from '@/lib/i18n';

export function WaitingHost() {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-4 rounded-lg border border-chip-warning-bg bg-chip-warning-bg p-6 text-center">
      <div className="relative h-3 w-3">
        <span className="absolute inset-0 animate-ping rounded-full bg-warning opacity-70" />
        <span className="relative inline-block h-3 w-3 rounded-full bg-warning" />
      </div>
      <h2 className="text-lg font-semibold text-chip-warning-fg">
        {t('lobby.waiting_host_title')}
      </h2>
      <p className="text-sm text-chip-warning-fg">
        {t('lobby.waiting_host_description')}
      </p>
    </div>
  );
}
