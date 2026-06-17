"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/ui/shadcn/button";
import { Sheet, SheetContent } from "@/ui/shadcn/sheet";
import { Sidebar } from "./Sidebar";
import { OrgSwitcher } from "./OrgSwitcher";
import { PendingActionsBell } from "./PendingActionsBell";

export function MobileHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 flex h-header items-center gap-3 border-b border-border-subtle bg-bg-elevated/80 px-4 backdrop-blur-glass md:hidden">
      <div className="flex items-center gap-2">
        <div className="grid h-7 w-7 place-items-center rounded-md bg-accent font-mono text-sm font-bold text-accent-fg">
          К
        </div>
        <span className="text-base font-semibold text-fg-primary">Кора</span>
      </div>

      <div className="min-w-0 flex-1">
        <OrgSwitcher variant="mobile" />
      </div>

      {}
      <PendingActionsBell />

      <Button
        variant="ghost"
        size="icon"
        aria-label="Открыть меню"
        onClick={() => setOpen(true)}
      >
        <Menu size={18} />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-sb max-w-none p-0">
          <Sidebar onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </header>
  );
}
