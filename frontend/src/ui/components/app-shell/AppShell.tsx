"use client";

import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { MobileHeader } from "./Header";
import { PendingActionsBell } from "./PendingActionsBell";
import {
  CommandPalette,
  CommandPaletteProvider,
} from "@/ui/components/command-palette";
import { ConciergeFloatingButton } from "@/ui/concierge/ConciergeFloatingButton";
import { SupportWidgetMount } from "@/ui/support/SupportWidgetMount";
import { PaywallBanner } from "@/ui/components/PaywallBanner";
import { PaywallModal } from "@/ui/components/PaywallModal";
import { TrackerBottomNav } from "@/ui/tracker/TrackerBottomNav";
import { MobileShell } from "@/ui/mobile/MobileShell";
import { MobileTabBar } from "@/ui/mobile/MobileTabBar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <CommandPaletteProvider>
      <div className="flex min-h-screen flex-col bg-bg-base text-fg-primary md:flex-row">
        {}
        <div className="hidden md:flex md:h-screen md:flex-none md:sticky md:top-0">
          <Sidebar />
        </div>

        {}
        <MobileHeader />

        {}
        <main className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
          {}
          <div className="hidden h-header items-center justify-end gap-2 border-b border-border-subtle bg-bg-surface/60 px-4 backdrop-blur-glass md:flex">
            <PendingActionsBell />
          </div>
          <PaywallBanner />
          {children}
        </main>

        {}
        <PaywallModal />

        {}
        <MobileShell mobile={<MobileTabBar />} desktop={<TrackerBottomNav />} />

        {}
        <CommandPalette />

        {}
        <ConciergeFloatingButton />

        {}
        <SupportWidgetMount />
      </div>
    </CommandPaletteProvider>
  );
}
