'use client';

/**
 * PaywallBanner — sticky-плашка «Демо-режим» на всех authenticated-страницах.
 *
 * Показывается только при `status === 'DEMO'`. При ACTIVE / null / loading —
 * рендерит null. Кнопка «Оплатить» ведёт на /settings/subscription.
 *
 * ТЗ: plans/tz/2026-05-28-paywall-no-trial.md §4.1.
 */

import Link from 'next/link';
import { Lock } from 'lucide-react';

import { useSubscription } from '@/hooks/useSubscription';
import { Button } from '@/ui/shadcn/button';

export function PaywallBanner() {
  const { status, loading } = useSubscription();

  if (loading || status !== 'DEMO') return null;

  return (
    <div
      className="sticky top-0 z-50 border-b border-warning/40 bg-warning/10 px-4 py-3"
      data-testid="paywall-banner"
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Lock size={20} className="shrink-0 text-warning" />
          <p className="text-sm text-fg-primary">
            <strong>Демо-режим:</strong> просмотр данных без возможности создания.
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/settings/subscription">Оплатить 60 000 ₽/мес</Link>
        </Button>
      </div>
    </div>
  );
}
