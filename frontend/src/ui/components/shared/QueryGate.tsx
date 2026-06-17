"use client";

import type { ReactNode } from "react";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";

type Props = {
  isLoading: boolean;
  error?: unknown;
  isEmpty?: boolean;
  skeleton?: ReactNode;
  empty?: ReactNode;
  errorView?: ReactNode;
  onRetry?: () => void;
  children: ReactNode;
};

export function QueryGate({
  isLoading,
  error,
  isEmpty,
  skeleton,
  empty,
  errorView,
  onRetry,
  children,
}: Props) {
  if (isLoading) {
    return (
      <>
        {skeleton ?? (
          <div className="space-y-3" aria-busy="true">
            <div className="z-shimmer h-6 w-1/3 rounded-sm" />
            <div className="z-shimmer h-24 w-full rounded-md" />
            <div className="z-shimmer h-24 w-full rounded-md" />
          </div>
        )}
      </>
    );
  }

  if (error) {
    if (errorView) return <>{errorView}</>;
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Не удалось загрузить данные";
    return <ErrorState message={message} onRetry={onRetry} />;
  }

  if (isEmpty) {
    return <>{empty ?? <EmptyState title="Пока ничего нет" />}</>;
  }

  return <>{children}</>;
}
