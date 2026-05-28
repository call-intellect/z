'use client';

/**
 * Skeleton-state для страницы Обзор. Показывается пока SWR грузит данные.
 */

export function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {/* header */}
      <div className="h-24 animate-pulse rounded-lg bg-bg-overlay" />
      {/* metrics */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-lg bg-bg-overlay"
          />
        ))}
      </div>
      {/* widgets row */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="h-40 animate-pulse rounded-lg bg-bg-overlay" />
        <div className="h-40 animate-pulse rounded-lg bg-bg-overlay" />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="h-48 animate-pulse rounded-lg bg-bg-overlay" />
        <div className="h-48 animate-pulse rounded-lg bg-bg-overlay" />
      </div>
    </div>
  );
}
