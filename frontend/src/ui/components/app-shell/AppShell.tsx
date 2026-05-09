'use client';

import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { MobileHeader } from './Header';
import { CommandPalette } from '@/ui/components/command-palette/CommandPalette';

/**
 * AppShell — основной layout для авторизованного кабинета.
 *
 * Desktop (md+): фиксированный sidebar 248px + main content.
 * Mobile: burger-header сверху + sidebar в Sheet.
 *
 * Существующие страницы (`/meetings`, `/meetings/create`, `/meetings/[id]/result`,
 * `/admin/*`) остаются как есть и рендерятся внутри `<main>`.
 *
 * Глобальная командная палитра (`⌘K`/`Ctrl+K`) монтируется здесь — доступна
 * на всех authenticated-страницах.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-bg-base text-fg-primary md:flex-row">
      {/* Desktop sidebar */}
      <div className="hidden md:flex md:h-screen md:flex-none md:sticky md:top-0">
        <Sidebar />
      </div>

      {/* Mobile header (only on small) */}
      <MobileHeader />

      <main className="flex min-w-0 flex-1 flex-col">{children}</main>

      {/* Глобальная ⌘K палитра. */}
      <CommandPalette />
    </div>
  );
}
