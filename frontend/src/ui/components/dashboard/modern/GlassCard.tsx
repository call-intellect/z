'use client';

import type { CSSProperties, ReactNode } from 'react';

import { cn } from '@/ui/shadcn/lib/utils';

import { glass } from './tokens';

/**
 * Базовая «стеклянная» карточка нового языка дашбордов. Оборачивает контент в
 * `glass()`-поверхность с паддингом `p-6`. При `glow` добавляет мягкое
 * радиальное свечение в правом-верхнем углу (как у `AiCard`).
 */
export function GlassCard({
  children,
  className,
  style,
  glow,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  glow?: boolean;
}) {
  return (
    <div
      style={glass(style)}
      className={cn('p-6', glow && 'relative overflow-hidden', className)}
    >
      {glow && (
        <div
          aria-hidden
          className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full blur-3xl"
          style={{ background: 'oklch(0.6 0.2 300 / 0.45)' }}
        />
      )}
      {children}
    </div>
  );
}
