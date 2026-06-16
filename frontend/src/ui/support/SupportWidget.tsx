"use client";

import { useState } from "react";
import Link from "next/link";
import { LifeBuoy, X } from "lucide-react";

import { cn } from "@/ui/shadcn/lib/utils";
import { SupportForm } from "./SupportForm";

export function SupportWidget() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "fixed bottom-24 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full",
          "bg-bg-card text-fg-secondary shadow-lg ring-1 ring-border-subtle transition-transform hover:scale-105 hover:text-fg-primary",
        )}
        aria-label="Служба поддержки"
        aria-expanded={open}
      >
        {open ? <X size={20} /> : <LifeBuoy size={20} />}
      </button>

      {}
      {open && (
        <div className="fixed bottom-40 right-6 z-40 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col rounded-lg border border-border-subtle bg-bg-base shadow-2xl">
          <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
            <div className="flex items-center gap-2">
              <LifeBuoy size={16} className="text-accent" />
              <h2 className="text-sm font-semibold text-fg-primary">
                Служба поддержки
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-fg-tertiary hover:text-fg-primary"
              aria-label="Закрыть"
            >
              <X size={16} />
            </button>
          </div>

          <div className="p-4">
            <p className="mb-3 text-xs text-fg-tertiary">
              Опишите проблему — мы ответим в ваших обращениях.
            </p>
            <SupportForm onSuccess={() => setOpen(false)} />
            <Link
              href="/support/my-tickets"
              onClick={() => setOpen(false)}
              className="mt-3 inline-block text-xs text-accent hover:underline"
            >
              Мои обращения
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
