'use client';

import { useEffect, useState } from 'react';

import { isChunkLoadError, tryReloadOnce } from '@/lib/chunk-reload';

import { Button } from './shared/Button';

type Props = {
  error: Error & { digest?: string };
  reset?: () => void;
};

export function AppErrorView({ error, reset }: Props) {
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (isChunkLoadError(error) && tryReloadOnce()) {
      setReloading(true);
    }
  }, [error]);

  if (reloading) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center px-6 py-8 text-center">
        <p className="text-sm text-fg-secondary">Обновляем страницу…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[40vh] items-center justify-center px-6 py-8">
      <div
        role="alert"
        className="flex flex-col items-center justify-center rounded-lg border border-chip-danger-bg bg-chip-danger-bg px-6 py-8 text-center"
      >
        <h3 className="mb-1 text-base font-semibold text-chip-danger-fg">
          Не удалось загрузить страницу
        </h3>
        <p className="mb-4 max-w-md text-sm text-chip-danger-fg">
          Попробуйте обновить страницу или вернуться назад.
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => (reset ? reset() : window.location.reload())}
        >
          Обновить
        </Button>
      </div>
    </div>
  );
}
