import clsx from 'clsx';
import type { HTMLAttributes } from 'react';

type Props = HTMLAttributes<HTMLDivElement>;

export function Skeleton({ className, ...rest }: Props) {
  return (
    <div
      aria-hidden="true"
      className={clsx('animate-pulse rounded bg-slate-200', className)}
      {...rest}
    />
  );
}
