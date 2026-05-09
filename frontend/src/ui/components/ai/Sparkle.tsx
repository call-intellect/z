'use client';

import { Sparkles } from 'lucide-react';
import { cn } from '@/ui/shadcn/lib/utils';

/** Иконка-индикатор AI-генерации с лёгким mint-glow. */
export function Sparkle({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <Sparkles
      size={size}
      strokeWidth={1.75}
      className={cn('text-accent drop-shadow-[0_0_6px_rgba(94,234,212,0.5)]', className)}
    />
  );
}
