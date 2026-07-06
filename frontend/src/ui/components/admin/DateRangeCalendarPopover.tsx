"use client";

import { useState } from "react";
import { CalendarIcon, X } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { Button } from "@/ui/shadcn/button";
import { Calendar } from "@/ui/shadcn/calendar";
import { cn } from "@/ui/shadcn/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/shadcn/popover";

function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateInputValue(v: string): Date {
  const [y, m, d] = v.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function DateRangeCalendarPopover({
  from,
  to,
  onChange,
  triggerLabel,
  className,
}: {
  from?: string;
  to?: string;
  onChange: (range: { from: string; to: string } | null) => void;
  triggerLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const committed: DateRange | undefined =
    from && to ? { from: parseDateInputValue(from), to: parseDateInputValue(to) } : undefined;
  const [draft, setDraft] = useState<DateRange | undefined>(committed);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setDraft(committed);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-9 gap-2 whitespace-nowrap font-normal", className)}
        >
          <CalendarIcon className="h-3.5 w-3.5" />
          {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          numberOfMonths={2}
          selected={draft}
          onSelect={setDraft}
        />
        <div className="flex items-center justify-between border-t border-border-subtle px-3 py-2">
          {committed ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onChange(null);
                setDraft(undefined);
                setOpen(false);
              }}
            >
              <X className="mr-1 h-3 w-3" />
              Сбросить
            </Button>
          ) : (
            <span className="text-xs text-fg-tertiary">Выберите период на календаре</span>
          )}
          <Button
            size="sm"
            disabled={!draft?.from || !draft?.to}
            onClick={() => {
              if (!draft?.from || !draft?.to) return;
              onChange({
                from: toDateInputValue(draft.from),
                to: toDateInputValue(draft.to),
              });
              setOpen(false);
            }}
          >
            Применить
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
