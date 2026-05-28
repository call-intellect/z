'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { MessageCircle, X } from 'lucide-react';

import { ConciergeChat } from './ConciergeChat';

/**
 * SBA γ-2 — Floating button Concierge'а. Видна на всех authenticated
 * страницах. Клик открывает popover с ConciergeChat. Получает текущий
 * `pathname` через `usePathname()` — подмешивается в pageContext.
 */
export function ConciergeFloatingButton() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      {!open && (
        <button
          type="button"
          aria-label="Открыть Concierge"
          data-tour-target="welcome.concierge"
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-fg shadow-lg hover:bg-accent-hover"
        >
          <MessageCircle size={22} />
        </button>
      )}
      {open && (
        <div className="fixed bottom-6 right-6 z-50 flex h-[600px] w-[380px] flex-col rounded-md border border-border-subtle bg-bg-base shadow-2xl">
          <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
            <div className="text-sm font-medium">Concierge</div>
            <button
              type="button"
              aria-label="Закрыть"
              onClick={() => setOpen(false)}
              className="rounded p-1 text-fg-tertiary hover:bg-bg-overlay"
            >
              <X size={16} />
            </button>
          </div>
          <ConciergeChat
            pageContext={{ clientPath: pathname ?? undefined }}
            className="flex flex-1 flex-col"
          />
        </div>
      )}
    </>
  );
}
