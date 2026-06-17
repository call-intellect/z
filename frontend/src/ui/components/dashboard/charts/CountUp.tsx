"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/ui/shadcn/lib/utils";

type Props = {
  to: number;
  durationMs?: number;
  format?: (n: number) => string;
  className?: string;
};

export function CountUp({
  to,
  durationMs = 600,
  format = defaultFormat,
  className,
}: Props) {
  const [display, setDisplay] = useState<number>(to);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const fromRef = useRef<number>(to);
  const displayRef = useRef<number>(to);

  useEffect(() => {
    displayRef.current = display;
  }, [display]);

  useEffect(() => {
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (prefersReduced || durationMs <= 0) {
      setDisplay(to);
      displayRef.current = to;
      return;
    }

    fromRef.current = displayRef.current;
    startRef.current = null;

    const tick = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const t = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = fromRef.current + (to - fromRef.current) * eased;
      setDisplay(next);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplay(to);
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [to, durationMs]);

  return (
    <span className={cn("tabular-nums", className)}>{format(display)}</span>
  );
}

function defaultFormat(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? n.toFixed(0) : n.toFixed(1);
}
