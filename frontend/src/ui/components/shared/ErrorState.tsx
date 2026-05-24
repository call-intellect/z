'use client';

import { Button } from './Button';

type Props = {
  title?: string;
  message: string;
  onRetry?: () => void;
};

export function ErrorState({
  title = 'Что-то пошло не так',
  message,
  onRetry,
}: Props) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-lg border border-chip-danger-bg bg-chip-danger-bg px-6 py-8 text-center"
    >
      <h3 className="mb-1 text-base font-semibold text-chip-danger-fg">{title}</h3>
      <p className="mb-4 max-w-md text-sm text-chip-danger-fg">{message}</p>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Повторить
        </Button>
      ) : null}
    </div>
  );
}
