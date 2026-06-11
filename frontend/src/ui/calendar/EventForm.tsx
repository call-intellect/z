'use client';

/**
 * EventForm — модалка создания / редактирования события календаря.
 *
 * Если `eventId` передан — режим редактирования; кнопка «Удалить» показывается.
 * При сохранении вызывает `calendarApi.createEvent` / `updateEvent`,
 * после успеха зовёт `onSaved()` (триггерит revalidate SWR).
 *
 * Поля: title, kind, startAt, endAt, location, description, visibility,
 * participants (упрощённый ввод email-ов через запятую — MVP).
 */

import { useEffect, useMemo, useState, type JSX } from 'react';

import { ApiError, humanizeApiError } from '@/api/api-error';
import {
  calendarApi,
  type CreateEventRequestApi,
  type EventKindApi,
  type EventVisibilityApi,
  type ParticipantInputApi,
  type UpdateEventRequestApi,
} from '@/api/calendar.api';
import { EVENT_KIND_LABELS, EVENT_VISIBILITY_LABELS } from '@/domain/calendar';
import type { CalendarEventDomain } from '@/domain/calendar';
import { Button } from '@/ui/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/shadcn/dialog';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import { Textarea } from '@/ui/shadcn/textarea';
import {
  ParticipantPicker,
  type ParticipantPickerValue,
} from '@/ui/shared/ParticipantPicker';

const KIND_OPTIONS: EventKindApi[] = [
  'meeting',
  'call',
  'offline_meeting',
  'personal_block',
  'deadline',
];

const VISIBILITY_OPTIONS: EventVisibilityApi[] = ['company', 'team', 'personal'];

export interface EventFormProps {
  open: boolean;
  onClose: () => void;
  /** Существующее событие (режим редактирования). */
  event?: CalendarEventDomain | null;
  /** Дата/время, на которое создаётся новое событие (для default startAt). */
  defaultStartAt?: Date;
  /** Опц. projectId — событие сразу привязывается к проекту. */
  projectId?: string;
  onSaved: () => void;
}

interface FormState {
  title: string;
  kind: EventKindApi;
  startAt: string; // datetime-local значение
  endAt: string;
  location: string;
  description: string;
  visibility: EventVisibilityApi;
  /** Calendar MVP Фаза P4 — структурированный список участников. */
  participants: ParticipantPickerValue[];
}

function toLocalInputValue(d: Date): string {
  // datetime-local требует формат YYYY-MM-DDTHH:mm без timezone-суффикса.
  const pad = (n: number): string => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function fromLocalInputValue(v: string): Date {
  // new Date("YYYY-MM-DDTHH:mm") интерпретируется как локальное время.
  return new Date(v);
}

function buildDefaultState(
  event: CalendarEventDomain | null | undefined,
  defaultStartAt: Date | undefined,
): FormState {
  if (event) {
    const startAt = toLocalInputValue(event.startAt);
    const endAt = event.endAt ? toLocalInputValue(event.endAt) : '';
    return {
      title: event.title,
      kind: event.kind,
      startAt,
      endAt,
      location: event.location ?? '',
      description: event.description ?? '',
      visibility: event.visibility,
      // В edit-режиме participants не редактируются (имена не приходят в EventDto).
      participants: [],
    };
  }
  const base = defaultStartAt ?? new Date();
  // Округляем до ближайших 30 минут вперёд.
  const rounded = new Date(base);
  rounded.setMinutes(Math.ceil(rounded.getMinutes() / 30) * 30, 0, 0);
  const endDefault = new Date(rounded.getTime() + 30 * 60 * 1000);
  return {
    title: '',
    kind: 'meeting',
    startAt: toLocalInputValue(rounded),
    endAt: toLocalInputValue(endDefault),
    location: '',
    description: '',
    visibility: 'company',
    participants: [],
  };
}

export function EventForm({
  open,
  onClose,
  event,
  defaultStartAt,
  projectId,
  onSaved,
}: EventFormProps): JSX.Element {
  const isEdit = !!event;
  const [state, setState] = useState<FormState>(() =>
    buildDefaultState(event, defaultStartAt),
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setState(buildDefaultState(event, defaultStartAt));
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event?.id]);

  const requiresEndAt = useMemo(
    () => state.kind !== 'personal_block' && state.kind !== 'deadline',
    [state.kind],
  );

  function setField<K extends keyof FormState>(
    key: K,
    value: FormState[K],
  ): void {
    setState((s) => ({ ...s, [key]: value }));
  }

  function validate(): string | null {
    if (!state.title.trim()) return 'Укажите название события.';
    if (!state.startAt) return 'Укажите дату и время начала.';
    const startDate = fromLocalInputValue(state.startAt);
    if (Number.isNaN(startDate.getTime())) {
      return 'Некорректная дата начала.';
    }
    if (requiresEndAt && !state.endAt) {
      return 'Для этого типа события нужно указать окончание.';
    }
    if (state.endAt) {
      const endDate = fromLocalInputValue(state.endAt);
      if (Number.isNaN(endDate.getTime())) {
        return 'Некорректная дата окончания.';
      }
      if (endDate < startDate) {
        return 'Окончание не может быть раньше начала.';
      }
      const minutes = (endDate.getTime() - startDate.getTime()) / 60000;
      if (state.kind === 'meeting' && minutes < 5) {
        return 'Длительность встречи должна быть не меньше 5 минут.';
      }
    }
    return null;
  }

  function buildParticipantsPayload(): ParticipantInputApi[] {
    return state.participants.map<ParticipantInputApi>((p) =>
      p.type === 'user'
        ? { userId: p.userId, role: 'required' }
        : { personId: p.personId, role: 'required' },
    );
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const startIso = fromLocalInputValue(state.startAt).toISOString();
      const endIso = state.endAt
        ? fromLocalInputValue(state.endAt).toISOString()
        : undefined;

      if (isEdit && event) {
        const patch: UpdateEventRequestApi = {
          title: state.title.trim(),
          kind: state.kind,
          startAt: startIso,
          endAt: endIso ?? null,
          visibility: state.visibility,
          location: state.location.trim() ? state.location.trim() : null,
          description: state.description.trim()
            ? state.description.trim()
            : null,
        };
        await calendarApi.updateEvent(event.id, patch);
      } else {
        const body: CreateEventRequestApi = {
          title: state.title.trim(),
          kind: state.kind,
          startAt: startIso,
          visibility: state.visibility,
          ...(endIso ? { endAt: endIso } : {}),
          ...(state.location.trim() ? { location: state.location.trim() } : {}),
          ...(state.description.trim()
            ? { description: state.description.trim() }
            : {}),
          ...(projectId ? { projectId } : {}),
        };
        const participants = buildParticipantsPayload();
        if (participants.length > 0) body.participants = participants;
        await calendarApi.createEvent(body);
      }
      onSaved();
      onClose();
    } catch (e2) {
      setError(
        humanizeApiError(e2, 'Не удалось сохранить событие.'),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!event) return;
    if (
      typeof window !== 'undefined' &&
      !window.confirm('Отменить и удалить это событие?')
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await calendarApi.cancelEvent(event.id);
      onSaved();
      onClose();
    } catch (e2) {
      setError(
        humanizeApiError(e2, 'Не удалось удалить событие.'),
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Редактирование события' : 'Новое событие'}
          </DialogTitle>
          <DialogDescription>
            Заполните поля и сохраните. Поля со звёздочкой обязательны.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="event-title">Название *</Label>
            <Input
              id="event-title"
              value={state.title}
              onChange={(e) => setField('title', e.target.value)}
              placeholder="Например, Созвон с командой по релизу"
              required
              maxLength={300}
            />
          </div>

          <div>
            <Label htmlFor="event-kind">Тип события</Label>
            <select
              id="event-kind"
              value={state.kind}
              onChange={(e) => setField('kind', e.target.value as EventKindApi)}
              className="flex h-10 w-full rounded-md border border-border-subtle bg-bg-overlay px-3 text-sm text-fg-primary focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {KIND_OPTIONS.map((k) => (
                <option key={k} value={k}>
                  {EVENT_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="event-start">Начало *</Label>
              <Input
                id="event-start"
                type="datetime-local"
                value={state.startAt}
                onChange={(e) => setField('startAt', e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="event-end">
                Окончание{requiresEndAt ? ' *' : ''}
              </Label>
              <Input
                id="event-end"
                type="datetime-local"
                value={state.endAt}
                onChange={(e) => setField('endAt', e.target.value)}
                {...(requiresEndAt ? { required: true } : {})}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="event-location">Место / ссылка</Label>
            <Input
              id="event-location"
              value={state.location}
              onChange={(e) => setField('location', e.target.value)}
              placeholder="Переговорка №2 или https://..."
              maxLength={300}
            />
          </div>

          <div>
            <Label htmlFor="event-description">Описание</Label>
            <Textarea
              id="event-description"
              value={state.description}
              onChange={(e) => setField('description', e.target.value)}
              rows={3}
              placeholder="Краткая повестка или контекст"
              maxLength={8000}
            />
          </div>

          <div>
            <Label>Видимость</Label>
            <div className="mt-1 flex flex-wrap gap-3 text-sm text-fg-secondary">
              {VISIBILITY_OPTIONS.map((v) => (
                <label key={v} className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="visibility"
                    value={v}
                    checked={state.visibility === v}
                    onChange={() => setField('visibility', v)}
                    className="text-accent"
                  />
                  <span>{EVENT_VISIBILITY_LABELS[v]}</span>
                </label>
              ))}
            </div>
          </div>

          {!isEdit &&
            state.kind !== 'personal_block' &&
            state.kind !== 'deadline' && (
              <div>
                <Label htmlFor="event-participants">Участники</Label>
                <ParticipantPicker
                  value={state.participants}
                  onChange={(next) => setField('participants', next)}
                  placeholder="Найти коллегу или внешний контакт"
                />
                <p className="mt-1 text-xs text-fg-tertiary">
                  Поиск по коллегам Org и внешним контактам. Если человека нет
                  в списке — вы можете добавить его как новый контакт прямо из
                  выпадающего меню.
                </p>
              </div>
            )}

          {error && (
            <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          {/* Calendar MVP Polish P1: для встреч с автосозданной LiveKit-комнатой
              показываем явную кнопку «Войти во встречу». Открываем в новой вкладке. */}
          {isEdit && event && event.joinUrl && (
            <a
              href={event.joinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-md border border-accent/60 bg-accent/10 px-3 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/20"
            >
              Войти во встречу
            </a>
          )}

          <DialogFooter className="gap-2">
            {isEdit && (
              <Button
                type="button"
                variant="destructive"
                onClick={() => void handleDelete()}
                disabled={deleting || saving}
              >
                {deleting ? 'Удаление…' : 'Удалить'}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={saving || deleting}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={saving || deleting}>
              {saving ? 'Сохранение…' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
