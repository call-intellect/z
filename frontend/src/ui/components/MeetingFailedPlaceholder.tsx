'use client';

import { t } from '@/lib/i18n';

export function MeetingFailedPlaceholder() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-4 py-12 text-center">
      <h1 className="text-2xl font-semibold text-red-700">
        {t('lobby.failed_title')}
      </h1>
      <p className="max-w-md text-sm text-slate-600">
        {t('lobby.failed_description')}
      </p>
    </main>
  );
}
