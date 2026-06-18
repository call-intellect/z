"use client";

import type { ReactElement } from "react";

import { cn } from "@/ui/shadcn/lib/utils";

const PALETTE: readonly string[] = [
  "#dc2626",
  "#ea580c",
  "#d97706",
  "#65a30d",
  "#16a34a",
  "#0d9488",
  "#0891b2",
  "#2563eb",
  "#4f46e5",
  "#7c3aed",
  "#c026d3",
  "#db2777",
] as const;

export function hashPaletteIndex(key: string, mod: number): number {
  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = (h * 33) ^ key.charCodeAt(i);
  }
  return Math.abs(h) % mod;
}

export function deriveInitials(roleName: string): string {
  const trimmed = (roleName ?? "").trim();
  if (trimmed.length === 0) return "?";

  const words = trimmed
    .split(/\s+/)
    .map((w) => {
      const m = w.match(/\p{L}/u);
      return m ? m[0]!.toUpperCase() : "";
    })
    .filter((w) => w.length > 0);

  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!;
  return (words[0]! + words[1]!).slice(0, 2);
}

export interface CloneAvatarProps {
  roleName: string;
  departmentId?: string | null;
  size?: number;
  className?: string;
}

export function CloneAvatar({
  roleName,
  departmentId,
  size = 48,
  className,
}: CloneAvatarProps): ReactElement {
  const initials = deriveInitials(roleName);
  const hashKey =
    (departmentId && departmentId.trim().length > 0
      ? departmentId
      : roleName) || "unknown";
  const colorIdx = hashPaletteIndex(hashKey, PALETTE.length);
  const bg = PALETTE[colorIdx]!;
  const fontSize = Math.round(size * 0.42);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Аватар клона: ${roleName}`}
      className={cn("shrink-0 rounded-full", className)}
    >
      <circle cx={size / 2} cy={size / 2} r={size / 2} fill={bg} />
      <text
        x="50%"
        y="50%"
        dy="0.07em"
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#ffffff"
        fontSize={fontSize}
        fontWeight={600}
        fontFamily="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
      >
        {initials}
      </text>
    </svg>
  );
}
