'use client';

/**
 * WeekView — 7 столбцов (Пн..Вс), 17 строк часов (06..22).
 * События — абсолютные блоки в столбце дня. Issue — ленточка под заголовком.
 *
 * Drag-and-drop: тащим Event на ячейку (день + час) → onMoveEvent(eventId, new Date).
 */

import { useMemo, type JSX } from 'react';

import { EVENT_KIND_STYLES } from '@/domain/calendar';
import type {
  CalendarEventDomain,
  CalendarIssueDomain,
  CalendarTimelineItem,
} from '@/domain/calendar';
import { cn } from '@/ui/shadcn/lib/utils';

import {
  FIRST_HOUR,
  HOUR_HEIGHT_PX,
  LAST_HOUR,
  VISIBLE_HOURS,
  WEEKDAY_SHORT,
  addDays,
  eventDayPositionPx,
  formatTimeHM,
  isSameDay,
  startOfDay,
  startOfWeek,
} from './dateHelpers';

interface WeekViewProps {
  cursorDate: Date;
  items: CalendarTimelineItem[];
  onSelectEvent: (event: CalendarEventDomain) => void;
  onSelectDay: (day: Date) => void;
  onMoveEvent: (eventId: string, newStart: Date) => void;
  onCreateAt: (start: Date) => void;
}

export function WeekView({
  cursorDate,
  items,
  onSelectEvent,
  onSelectDay,
  onMoveEvent,
  onCreateAt,
}: WeekViewProps): JSX.Element {
  const weekStart = startOfWeek(cursorDate);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const today = new Date();
  const hours = Array.from(
    { length: VISIBLE_HOURS },
    (_, i) => FIRST_HOUR + i,
  );

  const dayEvents = useMemo(() => {
    return days.map((d) => {
      const dStart = startOfDay(d);
      const dEnd = new Date(dStart.getTime() + 24 * 60 * 60 * 1000);
      const events: CalendarEventDomain[] = [];
      const issues: CalendarIssueDomain[] = [];
      for (const it of items) {
        if (it.type === 'event') {
          const eStart = it.startAt;
          const eEnd = it.endAt ?? new Date(eStart.getTime() + 30 * 60 * 1000);
          if (eEnd >= dStart && eStart < dEnd) events.push(it);
        } else if (isSameDay(it.dueDate, d)) {
          issues.push(it);
        }
      }
      events.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
      return { date: d, events, issues };
    });
  }, [days, items]);

  return (
    <div className="rounded-md border border-border-subtle bg-bg-card">
      {/* Заголовки дней */}
      <div className="grid grid-cols-[64px_repeat(7,minmax(0,1fr))] border-b border-border-subtle bg-bg-elevated">
        <div />
        {days.map((d, i) => {
          const isToday = isSameDay(d, today);
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelectDay(d)}
              className={cn(
                'flex flex-col items-center gap-0.5 border-l border-border-subtle py-2 text-xs transition-colors hover:bg-bg-overlay',
                isToday ? 'text-accent' : 'text-fg-tertiary',
              )}
            >
              <span className="font-medium">{WEEKDAY_SHORT[i]}</span>
              <span
                className={cn(
                  'inline-flex h-6 w-6 items-center justify-center rounded-full',
                  isToday && 'bg-accent text-accent-fg font-semibold',
                )}
              >
                {d.getDate()}
              </span>
            </button>
          );
        })}
      </div>

      {/* Ленточка задач (issues) под заголовком */}
      {dayEvents.some((d) => d.issues.length > 0) && (
        <div className="grid grid-cols-[64px_repeat(7,minmax(0,1fr))] border-b border-border-subtle bg-bg-overlay/30">
          <div className="px-2 py-1 text-[10px] text-fg-tertiary">Задачи</div>
          {dayEvents.map((d, i) => (
            <div
              key={i}
              className="space-y-0.5 border-l border-border-subtle p-1"
            >
              {d.issues.slice(0, 3).map((iss) => (
                <div
                  key={iss.id}
                  className="truncate rounded bg-red-500/10 px-1 py-0.5 text-[10px] dark:text-red-300 text-red-700"
                  title={iss.title}
                >
                  {iss.title}
                </div>
              ))}
              {d.issues.length > 3 && (
                <div className="px-1 text-[10px] text-fg-tertiary">
                  + ещё {d.issues.length - 3}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Сетка часов */}
      <div className="grid grid-cols-[64px_repeat(7,minmax(0,1fr))]">
        <div>
          {hours.map((h) => (
            <div
              key={h}
              className="flex items-start justify-end pr-2 pt-0.5 text-[11px] text-fg-tertiary"
              style={{ height: HOUR_HEIGHT_PX }}
            >
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>
        {dayEvents.map((d, i) => (
          <DayColumn
            key={i}
            day={d.date}
            events={d.events}
            hours={hours}
            onMoveEvent={onMoveEvent}
            onCreateAt={onCreateAt}
            onSelectEvent={onSelectEvent}
          />
        ))}
      </div>
    </div>
  );
}

interface DayColumnProps {
  day: Date;
  events: CalendarEventDomain[];
  hours: number[];
  onMoveEvent: (eventId: string, newStart: Date) => void;
  onCreateAt: (start: Date) => void;
  onSelectEvent: (event: CalendarEventDomain) => void;
}

function DayColumn({
  day,
  events,
  hours,
  onMoveEvent,
  onCreateAt,
  onSelectEvent,
}: DayColumnProps): JSX.Element {
  const dayStart = startOfDay(day);
  return (
    <div className="relative border-l border-border-subtle">
      {hours.map((h) => (
        <div
          key={h}
          className="border-b border-border-subtle"
          style={{ height: HOUR_HEIGHT_PX }}
        >
          <div
            className="h-1/2 cursor-pointer hover:bg-bg-overlay/50"
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData('text/calendar-event-id');
              if (!id) return;
              const ns = new Date(day);
              ns.setHours(h, 0, 0, 0);
              onMoveEvent(id, ns);
            }}
            onClick={() => {
              const ns = new Date(day);
              ns.setHours(h, 0, 0, 0);
              onCreateAt(ns);
            }}
          />
          <div
            className="h-1/2 cursor-pointer border-t border-dashed border-border-subtle/50 hover:bg-bg-overlay/50"
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData('text/calendar-event-id');
              if (!id) return;
              const ns = new Date(day);
              ns.setHours(h, 30, 0, 0);
              onMoveEvent(id, ns);
            }}
            onClick={() => {
              const ns = new Date(day);
              ns.setHours(h, 30, 0, 0);
              onCreateAt(ns);
            }}
          />
        </div>
      ))}

      {events.map((e) => (
        <WeekEventBlock
          key={e.id}
          event={e}
          dayStart={dayStart}
          onClick={() => onSelectEvent(e)}
        />
      ))}
    </div>
  );
}

function WeekEventBlock({
  event,
  dayStart,
  onClick,
}: {
  event: CalendarEventDomain;
  dayStart: Date;
  onClick: () => void;
}): JSX.Element {
  const endAt =
    event.endAt ?? new Date(event.startAt.getTime() + 30 * 60 * 1000);
  const { topPx, heightPx } = eventDayPositionPx(event.startAt, endAt, dayStart);
  const style = EVENT_KIND_STYLES[event.kind];
  const startMin = (event.startAt.getTime() - dayStart.getTime()) / 60000;
  if (startMin >= (LAST_HOUR + 1) * 60) return <></>;
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/calendar-event-id', event.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'absolute left-0.5 right-0.5 cursor-grab overflow-hidden rounded border px-1 py-0.5 text-left text-[11px] active:cursor-grabbing',
        style.bg,
        style.border,
        style.text,
      )}
      style={{ top: topPx, height: heightPx }}
      title={`${event.kindLabel} · ${formatTimeHM(event.startAt)} — ${formatTimeHM(endAt)}`}
    >
      <div className="truncate font-medium leading-tight">{event.title}</div>
      <div className="text-[10px] opacity-80">
        {formatTimeHM(event.startAt)}
      </div>
    </button>
  );
}
