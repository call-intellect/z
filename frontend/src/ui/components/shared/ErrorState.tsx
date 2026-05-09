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
      className="flex flex-col items-center justify-center rounded-lg border border-red-200 bg-red-50 px-6 py-8 text-center"
    >
      <h3 className="mb-1 text-base font-semibold text-red-900">{title}</h3>
      <p className="mb-4 max-w-md text-sm text-red-700">{message}</p>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Повторить
        </Button>
      ) : null}
    </div>
  );
}
