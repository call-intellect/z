"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";

export const CONCIERGE_OPEN_EVENT = "concierge:open";

export function ConciergeFloatingButton() {
  const router = useRouter();

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ prefill?: string }>).detail;
      const prefill = detail?.prefill;
      router.push(
        prefill ? `/chat?prefill=${encodeURIComponent(prefill)}` : "/chat",
      );
    };
    window.addEventListener(CONCIERGE_OPEN_EVENT, handler);
    return () => window.removeEventListener(CONCIERGE_OPEN_EVENT, handler);
  }, [router]);

  return (
    <button
      type="button"
      aria-label="Открыть Мастера"
      data-tour-target="welcome.concierge"
      onClick={() => router.push("/chat")}
      className="fixed bottom-20 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-fg shadow-lg transition-transform hover:scale-105 md:bottom-6"
    >
      <Sparkles size={22} />
    </button>
  );
}
