"use client";

import { useMemo, type JSX } from "react";

import { EVENT_KIND_STYLES } from "@/domain/calendar";
import type {
  CalendarEventDomain,
  CalendarIssueDomain,
  CalendarTimelineItem,
} from "@/domain/calendar";
import { cn } from "@/ui/shadcn/lib/utils";

import {
  WEEKDAY_SHORT,
  addDays,
  isSameDay,
  isSameMonth,
  monthGridStart,
} from "./dateHelpers";

interface MonthViewProps {
  cursorDate: Date;
  items: CalendarTimelineItem[];
  onSelectDay: (day: Date) => void;
  onSelectEvent: (event: CalendarEventDomain) => void;
  onMoveEvent: (eventId: string, targetDay: Date) => void;
}

interface DayBucket {
  date: Date;
  events: CalendarEventDomain[];
  issues: CalendarIssueDomain[];
}

const TOTAL_DAYS = 42;

export function MonthView({
  cursorDate,
  items,
  onSelectDay,
  onSelectEvent,
  onMoveEvent,
}: MonthViewProps): JSX.Element {
  const buckets = useMemo<DayBucket[]>(() => {
    const start = monthGridStart(cursorDate);
    const days: DayBucket[] = Array.from({ length: TOTAL_DAYS }, (_, i) => ({
      date: addDays(start, i),
      events: [],
      issues: [],
    }));
    for (const it of items) {
      const at = it.type === "event" ? it.startAt : it.dueDate;
      const bucket = days.find((d) => isSameDay(d.date, at));
      if (!bucket) continue;
      if (it.type === "event") bucket.events.push(it);
      else bucket.issues.push(it);
    }
    for (const b of days) {
      b.events.sort((a, c) => a.startAt.getTime() - c.startAt.getTime());
    }
    return days;
  }, [cursorDate, items]);

  const today = new Date();

  return (
    <div className="rounded-md border border-border-subtle bg-bg-card">
      <div className="grid grid-cols-7 border-b border-border-subtle bg-bg-elevated text-xs font-medium text-fg-tertiary">
        {WEEKDAY_SHORT.map((w) => (
          <div key={w} className="px-2 py-2 text-center">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {buckets.map((b, idx) => {
          const inMonth = isSameMonth(b.date, cursorDate);
          const isToday = isSameDay(b.date, today);
          const totalItems = b.events.length + b.issues.length;
          const limit = 3;
          const visible: CalendarTimelineItem[] = [
            ...b.events.slice(0, limit),
            ...b.issues.slice(0, Math.max(0, limit - b.events.length)),
          ];
          const more = Math.max(0, totalItems - visible.length);
          return (
            <div
              key={idx}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/calendar-event-id");
                if (id) onMoveEvent(id, b.date);
              }}
              className={cn(
                "min-h-[110px] cursor-pointer border-b border-r border-border-subtle p-1.5 transition-colors hover:bg-bg-overlay",
                !inMonth && "bg-bg-base/30 text-fg-tertiary",
                (idx + 1) % 7 === 0 && "border-r-0",
              )}
              onClick={() => onSelectDay(b.date)}
            >
              <div className="mb-1 flex items-center justify-between">
                <span
                  className={cn(
                    "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs",
                    isToday
                      ? "bg-accent text-accent-fg font-semibold"
                      : "text-fg-secondary",
                  )}
                >
                  {b.date.getDate()}
                </span>
              </div>
              <div className="space-y-0.5">
                {visible.map((it) =>
                  it.type === "event" ? (
                    <MonthEventChip
                      key={`e-${it.id}`}
                      event={it}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectEvent(it);
                      }}
                    />
                  ) : (
                    <MonthIssueChip key={`i-${it.id}`} issue={it} />
                  ),
                )}
                {more > 0 && (
                  <div className="px-1 text-[11px] text-fg-tertiary">
                    + ещё {more}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MonthEventChip({
  event,
  onClick,
}: {
  event: CalendarEventDomain;
  onClick: (e: React.MouseEvent) => void;
}): JSX.Element {
  const style = EVENT_KIND_STYLES[event.kind];
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/calendar-event-id", event.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={onClick}
      className={cn(
        "cursor-grab truncate rounded px-1 py-0.5 text-[11px] active:cursor-grabbing",
        style.bg,
        style.text,
      )}
      title={event.title}
    >
      {formatTimeShort(event.startAt)} {event.title}
    </div>
  );
}

function MonthIssueChip({
  issue,
}: {
  issue: CalendarIssueDomain;
}): JSX.Element {
  return (
    <div
      className="flex items-center gap-1 truncate px-1 py-0.5 text-[11px] text-fg-secondary"
      title={`Задача: ${issue.title}`}
    >
      <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-fg-tertiary" />
      <span className="truncate">{issue.title}</span>
    </div>
  );
}

function formatTimeShort(d: Date): string {
  return d.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
