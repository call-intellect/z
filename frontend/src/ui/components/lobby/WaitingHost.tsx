'use client';

import { t } from '@/lib/i18n';

export function WaitingHost() {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-4 rounded-lg border border-amber-200 bg-amber-50 p-6 text-center">
      <div className="relative h-3 w-3">
        <span className="absolute inset-0 animate-ping rounded-full bg-amber-400 opacity-70" />
        <span className="relative inline-block h-3 w-3 rounded-full bg-amber-500" />
      </div>
      <h2 className="text-lg font-semibold text-amber-900">
        {t('lobby.waiting_host_title')}
      </h2>
      <p className="text-sm text-amber-800">
        {t('lobby.waiting_host_description')}
      </p>
    </div>
  );
}
