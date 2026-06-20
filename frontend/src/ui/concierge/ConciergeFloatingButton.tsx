"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sparkles, X } from "lucide-react";

import { ConciergeChat } from "./ConciergeChat";

export const CONCIERGE_OPEN_EVENT = "concierge:open";

export function ConciergeFloatingButton() {
  const [open, setOpen] = useState(false);
  const [prefill, setPrefill] = useState<string | undefined>(undefined);
  const pathname = usePathname();

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ prefill?: string }>).detail;
      setPrefill(detail?.prefill ?? "");
      setOpen(true);
    };
    window.addEventListener(CONCIERGE_OPEN_EVENT, handler);
    return () => window.removeEventListener(CONCIERGE_OPEN_EVENT, handler);
  }, []);

  return (
    <>
      {!open && (
        <button
          type="button"
          aria-label="Открыть помощника"
          data-tour-target="welcome.concierge"
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-fg shadow-lg transition-transform hover:scale-105"
        >
          <Sparkles size={22} />
        </button>
      )}
      {open && (
        <div className="fixed bottom-6 right-6 z-50 flex h-[600px] w-[380px] flex-col rounded-md border border-border-subtle bg-bg-base shadow-2xl">
          <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
            <div className="text-sm font-medium">Консьерж</div>
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
            {...(prefill ? { initialInput: prefill } : {})}
          />
        </div>
      )}
    </>
  );
}
