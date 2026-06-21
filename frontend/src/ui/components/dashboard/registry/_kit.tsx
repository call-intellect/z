"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";

import { cn } from "@/ui/shadcn/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/ui/shadcn/sheet";
import { CHART } from "@/ui/components/dashboard/modern";

type ChipTone = "ok" | "warn" | "risk" | "neutral";

const CHIP_TONE: Record<ChipTone, { bg: string; fg: string }> = {
  ok: { bg: "var(--chip-success-bg)", fg: "var(--chip-success-fg)" },
  warn: { bg: "var(--chip-warning-bg)", fg: "var(--chip-warning-fg)" },
  risk: { bg: "var(--chip-danger-bg)", fg: "var(--chip-danger-fg)" },
  neutral: { bg: "var(--surface-inset-strong)", fg: "var(--text-secondary)" },
};

export function Chip({
  tone,
  children,
}: {
  tone: ChipTone;
  children: ReactNode;
}) {
  const t = CHIP_TONE[tone];
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ background: t.bg, color: t.fg }}
    >
      {children}
    </span>
  );
}

type ArrowDirection = "up" | "side" | "down";

const ARROW_TONE: Record<ArrowDirection, string> = {
  up: CHART.mint,
  side: CHART.violet,
  down: CHART.red,
};

const ARROW_LABEL: Record<ArrowDirection, string> = {
  up: "Движение к цели",
  side: "Дрейф в сторону",
  down: "Движение против цели",
};

export function MiniArrow({ direction }: { direction: ArrowDirection }) {
  const color = ARROW_TONE[direction];
  const Icon =
    direction === "up" ? ArrowUp : direction === "down" ? ArrowDown : ArrowRight;
  return (
    <span
      className="inline-grid h-6 w-6 place-items-center rounded-full"
      style={{ color, background: "var(--surface-inset)" }}
      role="img"
      aria-label={ARROW_LABEL[direction]}
    >
      <Icon size={15} />
    </span>
  );
}

function initialOf(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed[0]!.toUpperCase() : "?";
}

export function PersonRow({
  name,
  sub,
  right,
  onClick,
}: {
  name: string;
  sub?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold"
        style={{ background: "var(--surface-inset-strong)", color: CHART.text }}
        aria-hidden
      >
        {initialOf(name)}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className="block truncate text-sm font-medium"
          style={{ color: CHART.text }}
        >
          {name}
        </span>
        {sub && (
          <span className="block truncate text-xs" style={{ color: CHART.faint }}>
            {sub}
          </span>
        )}
      </span>
      {right && <span className="shrink-0">{right}</span>}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition hover:brightness-110"
        style={{ background: "var(--surface-inset)" }}
      >
        {inner}
      </button>
    );
  }

  return (
    <div
      className="flex w-full items-center gap-3 rounded-xl p-2.5"
      style={{ background: "var(--surface-inset)" }}
    >
      {inner}
    </div>
  );
}

export function SourceLink({
  href,
  label,
}: {
  href: string | null | undefined;
  label: ReactNode;
}) {
  if (!href) return null;
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition hover:brightness-110"
      style={{ background: "var(--surface-inset-strong)", color: CHART.text }}
    >
      {label}
      <ArrowRight size={13} />
    </Link>
  );
}

export function PeopleDrawer({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          "flex w-full flex-col gap-0 sm:max-w-md",
          className,
        )}
        style={{
          background: "var(--modern-page-bg)",
          backdropFilter: "var(--glass-blur)",
          WebkitBackdropFilter: "var(--glass-blur)",
        }}
      >
        <SheetHeader className="pb-4">
          <SheetTitle>{title}</SheetTitle>
          {subtitle ? (
            <SheetDescription>{subtitle}</SheetDescription>
          ) : (
            <SheetDescription className="sr-only">{title}</SheetDescription>
          )}
        </SheetHeader>
        <div className="-mr-2 flex-1 space-y-2 overflow-y-auto pr-2">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
