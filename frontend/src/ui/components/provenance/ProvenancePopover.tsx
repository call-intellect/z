"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, Lock } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/ui/shadcn/popover";
import type { ProvenanceRef } from "@/domain/provenance";

type Props = {
  ref_: ProvenanceRef;
  children: ReactNode;
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

function attributionLabel(attribution: ProvenanceRef["attribution"]): string {
  return attribution === "inferred" ? "〔вывод〕" : "〔цитата〕";
}

export function ProvenancePopover({ ref_, children }: Props) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        {ref_.accessFiltered ? (
          <div className="flex items-center gap-2 text-sm text-fg-tertiary">
            <Lock size={14} strokeWidth={1.75} aria-hidden />
            Источник скрыт правами доступа
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {typeof ref_.startMs === "number" ? (
                <span className="font-mono text-accent">
                  {fmtTime(ref_.startMs)}
                </span>
              ) : null}
              <span className="text-fg-secondary">{ref_.source.label}</span>
              <span className="text-fg-tertiary">
                {attributionLabel(ref_.attribution)}
              </span>
            </div>
            <p className="text-sm leading-relaxed text-fg-primary">
              «{ref_.quote}»
            </p>
            {ref_.attribution === "inferred" ? (
              <p className="text-xs text-fg-tertiary">
                По AI-выжимке отчёта, не дословно
              </p>
            ) : null}
            {ref_.source.deepLink ? (
              <Link
                href={ref_.source.deepLink}
                className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
              >
                <ArrowUpRight size={12} strokeWidth={1.75} aria-hidden />
                Перейти к первоисточнику
              </Link>
            ) : null}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
