'use client';

/**
 * CalendarView — корневой компонент календарного представления.
 *
 * Поддерживает два режима:
 *   - mode='me'      — глобальный «мой календарь» (/me/calendar).
 *   - mode='project' — календарь проекта; фильтр по projectId уходит на сервер
 *     (`GET /me/calendar?projectId=`) — клиентская фильтрация снята после
 *     Calendar MVP Polish P3 (2026-05-25).
 *
 * Состояние: режим отображения (day|week|month) и курсор-дата.
 * Данные: SWR-подписка на /me/calendar в окне [from, to].
 * Drag-and-drop: HTML5 native. PATCH события через `calendarApi.updateEvent`
 * + оптимистичная мутация SWR.
 */

import { useCallback, useMemo, useState, type JSX } from 'react';
import useSWR from 'swr';
import { CalendarPlus, ChevronLeft, ChevronRight } from 'lucide-react';

import { ApiError, humanizeApiError } from '@/api/api-error';
import {
  calendarApi,
  type CalendarItemApi,
  type CalendarResponseApi,
} from '@/api/calendar.api';
import { useProjectBySlug } from '@/hooks/tracker/useProjectBySlug';
import { useAuth } from '@/contexts/auth-context';
import {
  toCalendarTimelineItem,
  type CalendarEventDomain,
  type CalendarTimelineItem,
} from '@/domain/calendar';
import { Button } from '@/ui/shadcn/button';
import { cn } from '@/ui/shadcn/lib/utils';

import { DayView } from './DayView';
import { EventForm } from './EventForm';
import { MonthView } from './MonthView';
import { WeekView } from './WeekView';
import {
  addDays,
  addMonths,
  endOfDay,
  endOfMonth,
  endOfWeek,
  formatDayLabel,
  formatMonthLabel,
  formatWeekRangeLabel,
  moveDateToDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from './dateHelpers';

export type CalendarMode = 'me' | 'project';
export type CalendarViewMode = 'day' | 'week' | 'month';

export interface CalendarViewProps {
  mode: CalendarMode;
  /** Только для mode='project'. */
  projectSlug?: string;
}

interface RangeBounds {
  from: Date;
  to: Date;
}

function computeRange(viewMode: CalendarViewMode, cursor: Date): RangeBounds {
  switch (viewMode) {
    case 'day':
      return { from: startOfDay(cursor), to: endOfDay(cursor) };
    case 'week':
      return { from: startOfWeek(cursor), to: endOfWeek(cursor) };
    case 'month':
      return { from: startOfMonth(cursor), to: endOfMonth(cursor) };
  }
}

function formatRangeLabel(viewMode: CalendarViewMode, cursor: Date): string {
  switch (viewMode) {
    case 'day':
      return formatDayLabel(cursor);
    case 'week':
      return formatWeekRangeLabel(cursor);
    case 'month':
      return formatMonthLabel(cursor);
  }
}

export function CalendarView({
  mode,
  projectSlug,
}: CalendarViewProps): JSX.Element {
  const { currentOrgId } = useAuth();
  const projectQuery = useProjectBySlug(
    mode === 'project' ? currentOrgId : null,
    mode === 'project' ? projectSlug ?? null : null,
  );
  const projectId =
    mode === 'project' ? (projectQuery.project?.id ?? null) : null;

  const [viewMode, setViewMode] = useState<CalendarViewMode>('week');
  const [cursorDate, setCursorDate] = useState<Date>(() => new Date());
  const [editing, setEditing] = useState<CalendarEventDomain | null>(null);
  const [creating, setCreating] = useState<{
    open: boolean;
    defaultStart?: Date;
  }>({ open: false });

  const range = useMemo(
    () => computeRange(viewMode, cursorDate),
    [viewMode, cursorDate],
  );

  // Расширяем окно загрузки для месяца: тянем 6 недель сетки.
  const loadRange = useMemo(() => {
    if (viewMode !== 'month') return range;
    return {
      from: startOfWeek(range.from),
      to: endOfDay(addDays(startOfWeek(range.from), 41)),
    };
  }, [viewMode, range]);

  const swrKey = useMemo(
    () =>
      [
        'calendar',
        mode,
        projectId,
        loadRange.from.toISOString(),
        loadRange.to.toISOString(),
      ] as const,
    [mode, projectId, loadRange.from, loadRange.to],
  );

  const swr = useSWR<CalendarResponseApi>(swrKey, () =>
    calendarApi.getMyCalendar(
      loadRange.from.toISOString(),
      loadRange.to.toISOString(),
      // P3 (2026-05-25): projectId уходит на сервер; клиентский filter снят.
      mode === 'project' && projectId ? projectId : undefined,
    ),
  );

  const items: CalendarTimelineItem[] = useMemo(() => {
    if (!swr.data) return [];
    return swr.data.items.map(toCalendarTimelineItem);
  }, [swr.data]);

  // ─────────────────────── handlers ─────────────────────────

  const goToday = useCallback(() => setCursorDate(new Date()), []);
  const goPrev = useCallback(() => {
    setCursorDate((c) => {
      if (viewMode === 'day') return addDays(c, -1);
      if (viewMode === 'week') return addDays(c, -7);
      return addMonths(c, -1);
    });
  }, [viewMode]);
  const goNext = useCallback(() => {
    setCursorDate((c) => {
      if (viewMode === 'day') return addDays(c, 1);
      if (viewMode === 'week') return addDays(c, 7);
      return addMonths(c, 1);
    });
  }, [viewMode]);

  const openCreate = useCallback((defaultStart?: Date) => {
    setEditing(null);
    setCreating({ open: true, ...(defaultStart ? { defaultStart } : {}) });
  }, []);

  const openEdit = useCallback((ev: CalendarEventDomain) => {
    setCreating({ open: false });
    setEditing(ev);
  }, []);

  const handleSelectDay = useCallback(
    (day: Date) => {
      setCursorDate(day);
      setViewMode('day');
    },
    [],
  );

  // Оптимистично двигаем событие в SWR-кэше до ответа сервера.
  const handleMoveEvent = useCallback(
    async (eventId: string, newStart: Date, dropMode: 'day' | 'time') => {
      const current = swr.data;
      if (!current) return;
      const found = current.items.find(
        (it): it is Extract<CalendarItemApi, { type: 'event' }> =>
          it.type === 'event' && it.event.id === eventId,
      );
      if (!found) return;
      const oldStart = new Date(found.event.startAt);
      // В режиме 'day' (Month-view) сохраняем время, переносим день.
      // В режиме 'time' (Day/Week-view) выставляем точное время-startAt.
      const adjustedStart =
        dropMode === 'day' ? moveDateToDay(oldStart, newStart) : newStart;
      const duration = found.event.endAt
        ? new Date(found.event.endAt).getTime() - oldStart.getTime()
        : null;
      const newEnd = duration
        ? new Date(adjustedStart.getTime() + duration)
        : null;

      const optimistic: CalendarResponseApi = {
        items: current.items.map((it) =>
          it.type === 'event' && it.event.id === eventId
            ? {
                ...it,
                event: {
                  ...it.event,
                  startAt: adjustedStart.toISOString(),
                  endAt: newEnd ? newEnd.toISOString() : it.event.endAt,
                },
              }
            : it,
        ),
      };
      try {
        await swr.mutate(
          async () => {
            await calendarApi.updateEvent(eventId, {
              startAt: adjustedStart.toISOString(),
              ...(newEnd ? { endAt: newEnd.toISOString() } : {}),
            });
            return optimistic;
          },
          { optimisticData: optimistic, rollbackOnError: true, revalidate: true },
        );
      } catch (e) {
        const msg =
          humanizeApiError(e, 'Не удалось перенести событие.');
        if (typeof window !== 'undefined') window.alert(msg);
      }
    },
    [swr],
  );

  // ─────────────────────── render ─────────────────────────

  const subviewProps = {
    cursorDate,
    items,
    onSelectEvent: openEdit,
    onMoveEvent: (eventId: string, newStart: Date) =>
      void handleMoveEvent(eventId, newStart, 'time'),
  };

  return (
    <div className={mode === 'me' ? 'mx-auto w-full max-w-7xl px-4 py-6 md:px-6' : ''}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={goPrev}
            aria-label="Предыдущий период"
          >
            <ChevronLeft size={18} />
          </Button>
          <Button variant="secondary" size="sm" onClick={goToday}>
            Сегодня
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={goNext}
            aria-label="Следующий период"
          >
            <ChevronRight size={18} />
          </Button>
          <h2 className="ml-2 text-base font-semibold capitalize text-fg-primary md:text-lg">
            {formatRangeLabel(viewMode, cursorDate)}
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <ViewModeSwitcher value={viewMode} onChange={setViewMode} />
          <Button size="sm" onClick={() => openCreate()}>
            <CalendarPlus size={16} />
            Новое событие
          </Button>
        </div>
      </div>

      {swr.isLoading && !swr.data && (
        <div className="rounded-md border border-border-subtle bg-bg-card p-6 text-sm text-fg-tertiary">
          Загрузка календаря…
        </div>
      )}

      {swr.error && (
        <div className="mb-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {swr.error instanceof ApiError
            ? swr.error.message
            : 'Не удалось загрузить календарь.'}
        </div>
      )}

      {!swr.isLoading && (
        <>
          {viewMode === 'month' && (
            <MonthView
              cursorDate={cursorDate}
              items={items}
              onSelectDay={handleSelectDay}
              onSelectEvent={openEdit}
              onMoveEvent={(id, day) => void handleMoveEvent(id, day, 'day')}
            />
          )}
          {viewMode === 'week' && (
            <WeekView
              {...subviewProps}
              onSelectDay={handleSelectDay}
              onCreateAt={(start) => openCreate(start)}
            />
          )}
          {viewMode === 'day' && (
            <DayView
              {...subviewProps}
              onCreateAt={(start) => openCreate(start)}
            />
          )}
        </>
      )}

      <EventForm
        open={creating.open}
        onClose={() => setCreating({ open: false })}
        {...(creating.defaultStart
          ? { defaultStartAt: creating.defaultStart }
          : {})}
        {...(mode === 'project' && projectId ? { projectId } : {})}
        onSaved={() => void swr.mutate()}
      />
      <EventForm
        open={!!editing}
        onClose={() => setEditing(null)}
        event={editing}
        onSaved={() => void swr.mutate()}
      />
    </div>
  );
}

function ViewModeSwitcher({
  value,
  onChange,
}: {
  value: CalendarViewMode;
  onChange: (v: CalendarViewMode) => void;
}): JSX.Element {
  const options: Array<{ v: CalendarViewMode; label: string }> = [
    { v: 'day', label: 'День' },
    { v: 'week', label: 'Неделя' },
    { v: 'month', label: 'Месяц' },
  ];
  return (
    <div className="inline-flex rounded-md border border-border-subtle bg-bg-overlay p-0.5">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={cn(
            'rounded px-3 py-1 text-xs transition-colors',
            value === o.v
              ? 'bg-bg-card text-fg-primary'
              : 'text-fg-tertiary hover:text-fg-secondary',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
