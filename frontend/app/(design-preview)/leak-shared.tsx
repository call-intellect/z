'use client';

import Link from 'next/link';

/**
 * Переключатель между preview-вариантами секции «дырки в выручке».
 * Используется в `/leak-v1` и `/leak-v2`.
 */
export function PreviewSwitcher({ current }: { current: 'v1' | 'v2' }) {
  const items: Array<{ key: 'v1' | 'v2'; href: string; label: string }> = [
    { key: 'v1', href: '/leak-v1', label: 'V1 · Манифест' },
    { key: 'v2', href: '/leak-v2', label: 'V2 · Дырки и заплатки' },
  ];

  return (
    <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-5 md:px-10">
      <Link href="/" className="flex items-end gap-1.5" aria-label="Кора">
        <span className="text-xl font-bold tracking-[0.14em] text-fg-primary">
          КОРА
        </span>
        <span className="mb-1.5 h-1 w-1 rounded-full bg-accent" />
        <span className="ml-3 font-mono text-[10px] uppercase tracking-[0.18em] text-fg-tertiary">
          design preview
        </span>
      </Link>

      <nav className="flex items-center gap-2">
        {items.map((it) => (
          <Link
            key={it.key}
            href={it.href}
            aria-current={it.key === current ? 'page' : undefined}
            className={[
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              it.key === current
                ? 'border-accent-border bg-accent-muted text-accent-fg'
                : 'border-border-subtle text-fg-secondary hover:border-accent-border hover:text-accent',
            ].join(' ')}
          >
            {it.label}
          </Link>
        ))}
        <Link
          href="/"
          className="rounded-full border border-border-subtle px-3 py-1 text-xs font-medium text-fg-tertiary hover:border-accent-border hover:text-accent"
        >
          ← Главная
        </Link>
      </nav>
    </header>
  );
}
