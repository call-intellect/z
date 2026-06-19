"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

const POLL_INTERVAL_MS = 5 * 60 * 1000;

async function fetchVersion(): Promise<string | null> {
  try {
    const res = await fetch("/api/version", { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { version?: string };
    return json.version ?? null;
  } catch {
    return null;
  }
}

export function useVersionCheck() {
  const baselineRef = useRef<string | null>(null);
  const toastShownRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    fetchVersion().then((v) => {
      if (!cancelled) baselineRef.current = v;
    });

    const timer = setInterval(async () => {
      if (toastShownRef.current) return;
      const current = await fetchVersion();
      if (
        !cancelled &&
        current !== null &&
        baselineRef.current !== null &&
        current !== baselineRef.current
      ) {
        toastShownRef.current = true;
        toast("Доступна новая версия приложения", {
          description: "Обновите страницу, чтобы получить последние изменения.",
          duration: Infinity,
          action: {
            label: "Обновить",
            onClick: async () => {
              if ("caches" in window) {
                const keys = await caches.keys();
                await Promise.all(keys.map((k) => caches.delete(k)));
              }
              window.location.reload();
            },
          },
        });
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
}
