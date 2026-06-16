"use client";

import { useEffect } from "react";

import { registerServiceWorker } from "./register-sw";

export function PwaInit(): null {
  useEffect(() => {
    let cancelled = false;
    void registerServiceWorker().then((reg) => {
      if (cancelled) return;
      if (reg && reg.update) {
        reg.update().catch(() => {});
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
