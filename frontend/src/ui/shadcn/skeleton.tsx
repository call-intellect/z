import * as React from 'react';
import { cn } from './lib/utils';

/** Skeleton с gradient shimmer-анимацией (см. tokens.css `.z-shimmer`). */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('z-shimmer rounded-md', className)} {...props} />;
}
