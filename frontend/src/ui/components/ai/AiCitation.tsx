"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { Play, Lock } from "lucide-react";
import { cn } from "@/ui/shadcn/lib/utils";

export type AiCitationProps = {
  startMs?: number;
  speakerName: string;
  text: string;
  onClick?: () => void;
  className?: string;
  subtitle?: string;
  href?: string;
  attribution?: "quoted" | "inferred";
  accessFiltered?: boolean;
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

function attributionLabel(attribution: "quoted" | "inferred"): string {
  return attribution === "inferred" ? "〔вывод〕" : "〔цитата〕";
}

export function AiCitation({
  startMs,
  speakerName,
  text,
  onClick,
  className,
  subtitle,
  href,
  attribution,
  accessFiltered,
}: AiCitationProps) {
  if (accessFiltered) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border border-border-subtle bg-bg-overlay p-3 text-sm text-fg-tertiary",
          className,
        )}
      >
        <Lock size={14} strokeWidth={1.75} aria-hidden />
        Источник скрыт правами доступа
      </div>
    );
  }

  const interactive = typeof href === "string" || typeof onClick === "function";

  const inner = (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        {typeof startMs === "number" && (
          <span className="font-mono text-accent">{fmtTime(startMs)}</span>
        )}
        <span className="text-fg-secondary">{speakerName}</span>
        {attribution ? (
          <span className="text-fg-tertiary">{attributionLabel(attribution)}</span>
        ) : null}
      </div>
      <p className="text-sm leading-relaxed text-fg-primary">«{text}»</p>
      {subtitle ? (
        <p className="mt-1 text-xs text-fg-tertiary">{subtitle}</p>
      ) : null}
      {interactive && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-accent opacity-0 transition-opacity group-hover:opacity-100">
          <Play size={12} strokeWidth={1.75} />
          Перейти к моменту
        </div>
      )}
    </>
  );

  const baseClass = cn(
    "block w-full rounded-md border border-accent-border bg-accent-muted p-3 text-left",
    "backdrop-blur-glass",
    "transition-shadow duration-200",
    interactive &&
      "hover:shadow-glow-mint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
  );

  return (
    <motion.div
      whileHover={interactive ? { scale: 1.015 } : undefined}
      transition={{ type: "spring", stiffness: 400, damping: 28 }}
      className={cn("group block w-full", className)}
    >
      {href ? (
        <Link href={href} className={baseClass}>
          {inner}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={baseClass}>
          {inner}
        </button>
      ) : (
        <div className={baseClass}>{inner}</div>
      )}
    </motion.div>
  );
}
