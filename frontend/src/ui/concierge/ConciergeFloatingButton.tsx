"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sparkles, X } from "lucide-react";

import { ConciergeChat } from "./ConciergeChat";
import { ConciergeClonesTab } from "./ConciergeClonesTab";

export const CONCIERGE_OPEN_EVENT = "concierge:open";

type ConciergeMode = "company" | "clones";

export function ConciergeFloatingButton() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ConciergeMode>("company");
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
          className="fixed bottom-20 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-fg shadow-lg transition-transform hover:scale-105 md:bottom-6"
        >
          <Sparkles size={22} />
        </button>
      )}
      {open && (
        <div className="fixed bottom-20 right-6 z-50 flex h-[70vh] max-h-[600px] w-[calc(100vw-2rem)] max-w-[380px] flex-col rounded-md border border-border-subtle bg-bg-base shadow-2xl md:bottom-6 md:h-[600px]">
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
          <div className="flex border-b border-border-subtle">
            <button
              type="button"
              aria-current={mode === "company" ? "true" : undefined}
              onClick={() => setMode("company")}
              className={
                mode === "company"
                  ? "flex-1 px-3 py-2 text-sm font-medium bg-accent/15 text-accent-fg"
                  : "flex-1 px-3 py-2 text-sm text-fg-secondary hover:text-fg-primary"
              }
            >
              Помощник компании
            </button>
            <button
              type="button"
              aria-current={mode === "clones" ? "true" : undefined}
              onClick={() => setMode("clones")}
              className={
                mode === "clones"
                  ? "flex-1 px-3 py-2 text-sm font-medium bg-accent/15 text-accent-fg"
                  : "flex-1 px-3 py-2 text-sm text-fg-secondary hover:text-fg-primary"
              }
            >
              Клоны ролей
            </button>
          </div>
          {mode === "company" ? (
            <ConciergeChat
              pageContext={{ clientPath: pathname ?? undefined }}
              className="flex flex-1 flex-col"
              {...(prefill ? { initialInput: prefill } : {})}
            />
          ) : (
            <ConciergeClonesTab />
          )}
        </div>
      )}
    </>
  );
}
