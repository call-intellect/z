'use client';

import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { MobileHeader } from './Header';
import { PendingActionsBell } from './PendingActionsBell';
import { Breadcrumbs } from '@/ui/components/breadcrumbs/Breadcrumbs';
import {
  CommandPalette,
  CommandPaletteProvider,
} from '@/ui/components/command-palette';
import { ConciergeFloatingButton } from '@/ui/concierge/ConciergeFloatingButton';
import { SupportWidgetMount } from '@/ui/support/SupportWidgetMount';
import { PaywallBanner } from '@/ui/components/PaywallBanner';
import { PaywallModal } from '@/ui/components/PaywallModal';
import { ReferralRewardBanner } from '@/ui/components/app-shell/ReferralRewardBanner';
import { TrackerBottomNav } from '@/ui/tracker/TrackerBottomNav';
import { MobileShell } from '@/ui/mobile/MobileShell';
import { MobileTabBar } from '@/ui/mobile/MobileTabBar';

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
          {/* Action Center B1 — компактный desktop top-bar с глобальным
              колокольчиком (на мобильных колокольчик живёт в MobileHeader). */}
          <div className="hidden h-header items-center justify-between gap-2 border-b border-border-subtle bg-bg-surface/60 px-4 backdrop-blur-glass md:flex">
            <Breadcrumbs />
            <PendingActionsBell />
          </div>
          <PaywallBanner />
          {/* Единый persistent-баннер партнёрской программы (B3). Показывает
              живой прогресс окупаемости подписки руководителю и приглашение
              рядовому; не прячется при наличии профиля. Видимость + роль —
              `useReferralBannerVisibility` (whitelist ритмов/«Я» + paywall +
              dismiss-TTL 30 дней). */}
          <ReferralRewardBanner />
          {children}
        </main>

        {/* PaywallModal — глобальная модалка при 403 subscription_required.
            Рендерится через Radix Portal, позиция в DOM не важна. */}
        <PaywallModal />

        {/* Mobile bottom navigation (≤md). На desktop bottom-nav скрыт —
            навигация идёт через sidebar.

            ТЗ 2026-06-11 mobile-cora Ф1 (Б1/Б2): viewport-gate `MobileShell`
            рендерит РОВНО ОДНО дерево навигации — ниже md role-aware
            `MobileTabBar` (exec/manager), на md+ исторический `TrackerBottomNav`
            (сам `md:hidden`, на десктопе невидим → визуальный диф desktop = 0).
            Свопается только нижняя навигация, контент `children` рендерится
            один раз → без двойного fetch. */}
        <MobileShell mobile={<MobileTabBar />} desktop={<TrackerBottomNav />} />

        {/* Глобальная ⌘K палитра. Wave 2 B2: рендерится внутри Provider'а,
            keyboard listener живёт в Provider'е, открытие — из любого
            места через useCommandPalette(). */}
        <CommandPalette />

        {/* SBA γ-2 — Консьерж без собственного FAB (ТЗ-2 Ф3, Р4): открывается
            только по событию `concierge:open`, напр. из «Спросить Кору» в
            Таблицах. Единственная плавающая кнопка — «Помощник компании»
            (AssistantSidebar в AuthenticatedShell). */}
        <ConciergeFloatingButton />

        {/* Служба поддержки (ТЗ 2026-06-09 support-desk Ф1) — плавающий виджет
            создания обращения. Показывается только когда деск настроен
            (useSupportStatus().deskEnabled); FAB поднят над «Помощником». */}
        <SupportWidgetMount />
      </div>
    </CommandPaletteProvider>
  );
}
