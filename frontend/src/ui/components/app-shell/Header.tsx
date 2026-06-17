'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Menu } from 'lucide-react';
import { Button } from '@/ui/shadcn/button';
import { Sheet, SheetContent } from '@/ui/shadcn/sheet';
import { Sidebar } from './Sidebar';
import { OrgSwitcher } from './OrgSwitcher';
import { PendingActionsBell } from './PendingActionsBell';
import { useBreadcrumbTrail } from '@/ui/components/breadcrumbs/useBreadcrumbTrail';

/**
 * Mobile header — burger который открывает sidebar в Sheet.
 * На desktop этот компонент не показывается (см. AppShell).
 *
 * Расположение элементов (Фаза 0c §5.3):
 *   [Лого Z] [OrgSwitcher mobile] ...spacer... [бургер]
 *
 * `OrgSwitcher` сам решает, что рендерить (0/1/N memberships) и скрывается
 * автоматически на роутах wizard'а `/onboarding/company/*`.
 */
export function MobileHeader() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const trail = useBreadcrumbTrail();
  // Цель «назад» — ближайшее предшествующее звено с href.
  const backItem = [...trail].slice(0, -1).reverse().find((it) => it.href);
  const showBack = trail.length >= 2 && Boolean(backItem);

  return (
    <header className="sticky top-0 z-40 flex h-header items-center gap-3 border-b border-border-subtle bg-bg-elevated/80 px-4 backdrop-blur-glass md:hidden">
      {showBack && backItem ? (
        <>
          <button
            type="button"
            aria-label="Назад"
            onClick={() => router.push(backItem.href!)}
            className="grid h-9 w-9 flex-none place-items-center rounded-md text-fg-secondary transition-colors hover:bg-bg-overlay hover:text-fg-primary"
          >
            <ChevronLeft size={20} />
          </button>
          <span className="min-w-0 flex-1 truncate text-base font-semibold text-fg-primary">
            {trail[trail.length - 1].label}
          </span>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-md bg-accent font-mono text-sm font-bold text-accent-fg">
              К
            </div>
            <span className="text-base font-semibold text-fg-primary">Кора</span>
          </div>

          <div className="min-w-0 flex-1">
            <OrgSwitcher variant="mobile" />
          </div>
        </>
      )}

      {/* Action Center B1 — глобальный колокольчик рядом с бургером. */}
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
