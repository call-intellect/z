'use client';

import Link from 'next/link';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';

import { slideUp } from '@/ui/motion';

/**
 * Универсальная обёртка для публичных auth-страниц
 * (`/login`, `/signup`, `/forgot-password`, `/reset-password`).
 *
 * Стилистика — dark-first minimalism: subtle gradient mesh на фоне +
 * центрированная карточка ~480px. Логотип Z в шапке.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-bg-base px-4 py-10">
      {/* Subtle radial mesh background — mint accent, низкая opacity. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-0"
        style={{
          background:
            'radial-gradient(circle at 30% 20%, rgba(94,234,212,0.08), transparent 60%), radial-gradient(circle at 80% 80%, rgba(94,234,212,0.04), transparent 60%)',
        }}
      />

      <div className="relative z-10 mb-8 flex items-center gap-2">
        <Link
          href="/"
          className="flex items-center gap-2"
          aria-label="На главную"
        >
          <div className="grid h-9 w-9 place-items-center rounded-md bg-accent font-mono text-base font-bold text-accent-fg shadow-glow-mint">
            К
          </div>
          <span className="text-xl font-semibold tracking-tight text-fg-primary">
            Кора
          </span>
        </Link>
      </div>

      <motion.div
        variants={slideUp}
        initial="initial"
        animate="animate"
        className="relative z-10 w-full max-w-[480px]"
      >
        <div className="rounded-lg border border-border-subtle bg-bg-card p-8 shadow-elevated backdrop-blur-glass">
          <header className="mb-6 space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
              {title}
            </h1>
            {subtitle ? (
              <p className="text-sm text-fg-secondary">{subtitle}</p>
            ) : null}
          </header>
          {children}
        </div>
        {footer ? (
          <div className="mt-4 text-center text-sm text-fg-secondary">
            {footer}
          </div>
        ) : null}
      </motion.div>
    </main>
  );
}
