'use client';

import { Search } from 'lucide-react';

import { cn } from '@/ui/shadcn/lib/utils';
import { useCommandPalette } from './CommandPaletteProvider';

/**
 * Wave 2 B2 — кнопка «⌘K» для desktop topbar/sidebar.
 *
 * На мобильных скрыта (`hidden md:inline-flex`) — там палитра открывается
 * через bottom-nav иконку «Кора-помощник» (γ-2) или жест.
 *
 * Использование:
 *
 *   <CommandPaletteTrigger className="ml-auto" />
 */
export function CommandPaletteTrigger({
  className,
  variant = 'subtle',
}: {
  className?: string;
  variant?: 'subtle' | 'compact';
}) {
  const { open } = useCommandPalette();

  if (variant === 'compact') {
    return (
      <button
        type="button"
        onClick={() => open()}
        aria-label="Открыть командную палитру"
        className={cn(
          'hidden h-8 w-8 items-center justify-center rounded-md border border-border-subtle bg-bg-elevated text-fg-tertiary transition-colors hover:bg-bg-overlay hover:text-fg-primary md:inline-flex',
          className,
        )}
      >
        <Search size={14} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => open()}
      aria-label="Открыть командную палитру"
      className={cn(
        'hidden h-9 items-center gap-2 rounded-md border border-border-subtle bg-bg-elevated px-3 text-sm text-fg-tertiary transition-colors hover:bg-bg-overlay hover:text-fg-primary md:inline-flex',
        className,
      )}
    >
      <Search size={14} />
      <span>Поиск или команда…</span>
      <kbd className="ml-auto rounded border border-border-subtle bg-bg-overlay px-1.5 py-0.5 font-mono text-[10px] text-fg-tertiary">
        ⌘K
      </kbd>
    </button>
  );
}
