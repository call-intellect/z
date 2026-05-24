'use client';

import Link from 'next/link';
import { t } from '@/lib/i18n';

type Props = {
  meetingId: string;
  isHost: boolean;
};

export function MeetingFinishedPlaceholder({ meetingId, isHost }: Props) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg-subtle px-4 py-12 text-center">
      <h1 className="text-2xl font-semibold text-fg-primary">
        {t('lobby.finished_title')}
      </h1>
      <p className="max-w-md text-sm text-fg-secondary">
        {t('lobby.finished_description')}
      </p>
      {isHost ? (
        <Link
          href={`/meetings/${meetingId}/result`}
          className="inline-flex items-center justify-center rounded-md bg-accent px-5 py-2.5 text-base font-medium text-accent-fg transition-colors hover:bg-accent-hover"
        >
          {t('lobby.open_result')}
        </Link>
      ) : null}
    </main>
  );
}
