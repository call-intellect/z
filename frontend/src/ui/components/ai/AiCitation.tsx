"use client";

import { motion } from "motion/react";
import { Play } from "lucide-react";
import { cn } from "@/ui/shadcn/lib/utils";

export type AiCitationProps = {
  startMs?: number;
  speakerName: string;
  text: string;
  onClick?: () => void;
  className?: string;
};

function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`
    : `${m}:${sec.toString().padStart(2, "0")}`;
}

export function AiCitation({
  startMs,
  speakerName,
  text,
  onClick,
  className,
}: AiCitationProps) {
  const interactive = typeof onClick === "function";
  const Comp: "div" | "button" = interactive ? "button" : "div";

  return (
    <motion.div
      whileHover={interactive ? { scale: 1.015 } : undefined}
      transition={{ type: "spring", stiffness: 400, damping: 28 }}
      className={cn("group block w-full", className)}
    >
      <Comp
        type={interactive ? "button" : undefined}
        onClick={onClick}
        className={cn(
          "block w-full rounded-md border border-accent-border bg-accent-muted p-3 text-left",
          "backdrop-blur-glass",
          "transition-shadow duration-200",
          interactive &&
            "hover:shadow-glow-mint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        )}
      >
        <div className="mb-2 flex items-center gap-2 text-xs">
          {typeof startMs === "number" && (
            <span className="font-mono text-accent">{fmtTime(startMs)}</span>
          )}
          <span className="text-fg-secondary">{speakerName}</span>
        </div>
        <p className="text-sm leading-relaxed text-fg-primary">«{text}»</p>
        {interactive && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-accent opacity-0 transition-opacity group-hover:opacity-100">
            <Play size={12} strokeWidth={1.75} />
            Перейти к моменту
          </div>
        )}
      </Comp>
    </motion.div>
  );
}
