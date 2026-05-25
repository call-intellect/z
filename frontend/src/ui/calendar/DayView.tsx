'use client';

/**
 * DayView — один столбец × 17 строк (FIRST_HOUR..LAST_HOUR).
 * Event-ы — абсолютно позиционированные блоки. Issue (дедлайны) — ленточка
 * под заголовком дня.
 *
 * Drag-and-drop: пользователь схватывает событие и кладёт его в другую
 * 30-минутную ячейку → onMoveEvent(eventId, newStart).
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
  endOfDay,
  eventDayPositionPx,
  formatTimeHM,
  isSameDay,
  startOfDay,
} from './dateHelpers';

interface DayViewProps {
  cursorDate: Date;
  items: CalendarTimelineItem[];
  onSelectEvent: (event: CalendarEventDomain) => void;
  onMoveEvent: (eventId: string, newStart: Date) => void;
  onCreateAt: (start: Date) => void;
}

export function DayView({
  cursorDate,
  items,
  onSelectEvent,
  onMoveEvent,
  onCreateAt,
}: DayViewProps): JSX.Element {
  const dayStart = startOfDay(cursorDate);
  const dayEnd = endOfDay(cursorDate);

  const { events, issues } = useMemo(() => {
    const ev: CalendarEventDomain[] = [];
    const iss: CalendarIssueDomain[] = [];
    for (const it of items) {
      if (it.type === 'event') {
        const start = it.startAt;
        const end = it.endAt ?? new Date(start.getTime() + 30 * 60 * 1000);
        if (end >= dayStart && start <= dayEnd) ev.push(it);
      } else if (isSameDay(it.dueDate, cursorDate)) {
        iss.push(it);
      }
    }
    ev.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    return { events: ev, issues: iss };
  }, [items, dayStart, dayEnd, cursorDate]);

  const hours = Array.from(
    { length: VISIBLE_HOURS },
    (_, i) => FIRST_HOUR + i,
  );

  return (
    <div className="rounded-md border border-border-subtle bg-bg-card">
      {issues.length > 0 && (
        <div className="border-b border-border-subtle bg-bg-elevated p-2">
          <div className="mb-1 text-xs font-medium text-fg-tertiary">
            Дедлайны задач сегодня
          </div>
          <ul className="space-y-1 text-xs text-fg-secondary">
            {issues.map((i) => (
              <li key={i.id} className="flex items-center gap-2">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-400" />
                <span className="truncate">{i.title}</span>
                {i.projectName && (
                  <span className="text-fg-tertiary">· {i.projectName}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex">
        <div className="w-16 shrink-0 border-r border-border-subtle">
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

        <div className="relative flex-1">
          {hours.map((h) => (
            <HourSlot
              key={h}
              hour={h}
              day={cursorDate}
              onMoveEvent={onMoveEvent}
              onCreateAt={onCreateAt}
            />
          ))}
          {events.map((e) => (
            <DayEventBlock
              key={e.id}
              event={e}
              dayStart={dayStart}
              onClick={() => onSelectEvent(e)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function HourSlot({
  hour,
  day,
  onMoveEvent,
  onCreateAt,
}: {
  hour: number;
  day: Date;
  onMoveEvent: (eventId: string, newStart: Date) => void;
  onCreateAt: (start: Date) => void;
}): JSX.Element {
  // Делим час на 2 пол-часовые зоны drop. Чтобы пользователь не мучился —
  // основная цель — час, минуты остаются как в источнике (если drop с другой
  // ячейки) либо 0/30 при перетаскивании по визуальной зоне.
  return (
    <div
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
          const newStart = new Date(day);
          newStart.setHours(hour, 0, 0, 0);
          onMoveEvent(id, newStart);
        }}
        onClick={() => {
          const start = new Date(day);
          start.setHours(hour, 0, 0, 0);
          onCreateAt(start);
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
          const newStart = new Date(day);
          newStart.setHours(hour, 30, 0, 0);
          onMoveEvent(id, newStart);
        }}
        onClick={() => {
          const start = new Date(day);
          start.setHours(hour, 30, 0, 0);
          onCreateAt(start);
        }}
      />
    </div>
  );
}

interface DayEventBlockProps {
  event: CalendarEventDomain;
  dayStart: Date;
  onClick: () => void;
}

export function DayEventBlock({
  event,
  dayStart,
  onClick,
}: DayEventBlockProps): JSX.Element {
  const endAt =
    event.endAt ?? new Date(event.startAt.getTime() + 30 * 60 * 1000);
  const { topPx, heightPx } = eventDayPositionPx(event.startAt, endAt, dayStart);
  const style = EVENT_KIND_STYLES[event.kind];
  const dayEndMin = (LAST_HOUR + 1) * 60;
  const dayBeginMin = FIRST_HOUR * 60;
  const startMin = (event.startAt.getTime() - dayStart.getTime()) / 60000;
  if (startMin >= dayEndMin) return <></>;
  const visibleStart = Math.max(startMin, dayBeginMin);
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
        'absolute left-1 right-1 cursor-grab overflow-hidden rounded border px-2 py-1 text-left text-xs active:cursor-grabbing',
        style.bg,
        style.border,
        style.text,
      )}
      style={{ top: topPx, height: heightPx }}
      title={`${event.kindLabel} · ${formatTimeHM(event.startAt)} — ${formatTimeHM(endAt)}`}
    >
      <div className="font-medium leading-tight">{event.title}</div>
      <div className="text-[10px] opacity-80">
        {formatTimeHM(event.startAt)}
        {visibleStart > startMin ? ' (начало раньше)' : ''}
      </div>
    </button>
  );
}
