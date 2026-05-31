'use client';

import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { MobileHeader } from './Header';
import {
  CommandPalette,
  CommandPaletteProvider,
} from '@/ui/components/command-palette';
import { ConciergeFloatingButton } from '@/ui/concierge/ConciergeFloatingButton';
import { PaywallBanner } from '@/ui/components/PaywallBanner';
import { PaywallModal } from '@/ui/components/PaywallModal';
import { ReferralPromoStrip } from '@/ui/components/app-shell/ReferralPromoStrip';
import { TrackerBottomNav } from '@/ui/tracker/TrackerBottomNav';

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
 * на всех authenticated-страницах. Floating button Concierge (SBA γ-2) —
 * sквозной AI-помощник кабинета, тоже доступен везде.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <CommandPaletteProvider>
      <div className="flex min-h-screen flex-col bg-bg-base text-fg-primary md:flex-row">
        {/* Desktop sidebar */}
        <div className="hidden md:flex md:h-screen md:flex-none md:sticky md:top-0">
          <Sidebar />
        </div>

        {/* Mobile header (only on small) */}
        <MobileHeader />

        {/* `pb-16` на мобильных — чтобы контент не закрывался TrackerBottomNav
            (~56px); на md+ bottom-nav скрыт и padding не нужен. */}
        <main className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
          <PaywallBanner />
          {/* Promo-полоса реферальной программы — видна только тем, у кого
              ещё нет Referral-профиля, не на paywall и не на blacklist-страницах.
              Логика — `useReferralPromoVisibility` (ТЗ §8.3a). */}
          <ReferralPromoStrip />
          {children}
        </main>

        {/* PaywallModal — глобальная модалка при 403 subscription_required.
            Рендерится через Radix Portal, позиция в DOM не важна. */}
        <PaywallModal />

        {/* Mobile bottom navigation (≤md). На desktop bottom-nav скрыт —
            навигация идёт через sidebar. */}
        <TrackerBottomNav />

        {/* Глобальная ⌘K палитра. Wave 2 B2: рендерится внутри Provider'а,
            keyboard listener живёт в Provider'е, открытие — из любого
            места через useCommandPalette(). */}
        <CommandPalette />

        {/* SBA γ-2 — sквозной floating Concierge. */}
        <ConciergeFloatingButton />
      </div>
    </CommandPaletteProvider>
  );
}
