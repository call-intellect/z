'use client';

import { AppErrorView } from '@/ui/components/AppErrorView';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ru">
      <body>
        <AppErrorView error={error} reset={reset} />
      </body>
    </html>
  );
}
