'use client';

import { useEffect, useMemo, useState, type JSX } from 'react';
import { toast } from 'sonner';

import { ApiError, humanizeApiError } from '@/api/api-error';
import {
  calendarApi,
  type CreateEventRequestApi,
  type EventKindApi,
  type EventVisibilityApi,
  type ParticipantInputApi,
  type ReminderChannelApi,
  type ReminderInputApi,
  type UpdateEventRequestApi,
} from '@/api/calendar.api';
import { EVENT_KIND_LABELS, EVENT_VISIBILITY_LABELS } from '@/domain/calendar';
import type { CalendarEventDomain } from '@/domain/calendar';
import {
  DEFAULT_TIMEZONE,
  TIMEZONE_OPTIONS,
} from '@/ui/calendar/timezone-options';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
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
import { Switch } from '@/ui/shadcn/switch';
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

const RRULE_PRESETS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'Не повторять' },
  { value: 'FREQ=DAILY', label: 'Каждый день' },
  { value: 'FREQ=WEEKLY', label: 'Каждую неделю' },
  { value: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', label: 'По будням' },
  { value: 'FREQ=MONTHLY', label: 'Каждый месяц' },
  { value: 'FREQ=YEARLY', label: 'Каждый год' },
];

const RRULE_CUSTOM_SENTINEL = '__custom__';

function normalizeRrule(rrule: string): string {
  const cleaned = rrule
    .trim()
    .replace(/^RRULE:/i, '')
    .toUpperCase()
    .replace(/\s+/g, '');
  if (!cleaned) return '';
  return cleaned.split(';').filter(Boolean).sort().join(';');
}

function matchRrulePreset(rrule: string | null | undefined): string {
  if (!rrule || !rrule.trim()) return '';
  const norm = normalizeRrule(rrule);
  for (const preset of RRULE_PRESETS) {
    if (preset.value && normalizeRrule(preset.value) === norm) {
      return preset.value;
    }
  }
  return RRULE_CUSTOM_SENTINEL;
}

const REMINDER_OFFSET_OPTIONS: ReadonlyArray<{
  value: number;
  label: string;
}> = [
  { value: 0, label: 'В момент начала' },
  { value: 5, label: 'За 5 минут' },
  { value: 15, label: 'За 15 минут' },
  { value: 30, label: 'За 30 минут' },
  { value: 60, label: 'За 1 час' },
  { value: 1440, label: 'За 1 день' },
];

const REMINDER_CHANNEL_OPTIONS: ReadonlyArray<{
  value: ReminderChannelApi;
  label: string;
}> = [
  { value: 'push', label: 'Push' },
  { value: 'email', label: 'Почта' },
  { value: 'telegram', label: 'Telegram' },
];

const REMINDER_CHANNEL_LABELS: Record<ReminderChannelApi, string> = {
  push: 'Push',
  email: 'Почта',
  telegram: 'Telegram',
};

const MAX_REMINDERS = 20;

interface ReminderDraft {
  offsetMin: number;
  channel: ReminderChannelApi;
}

const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-border-subtle bg-bg-overlay px-3 text-sm text-fg-primary focus:outline-none focus:ring-2 focus:ring-accent';

export interface EventFormProps {
  open: boolean;
  onClose: () => void;
  event?: CalendarEventDomain | null;
  defaultStartAt?: Date;
  projectId?: string;
  onSaved: () => void;
}

interface FormState {
  title: string;
  kind: EventKindApi;
  startAt: string;
  endAt: string;
  location: string;
  counterparty: string;
  online: boolean;
  description: string;
  visibility: EventVisibilityApi;
  participants: ParticipantPickerValue[];
  allDay: boolean;
  timezone: string;
  rrulePreset: string;
  rruleRaw: string;
  reminders: ReminderDraft[];
}

function toLocalInputValue(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function fromLocalInputValue(v: string): Date {
  return new Date(v);
}

function dateOnly(v: string): string {
  return v.slice(0, 10);
}

function withDate(prev: string, date: string): string {
  if (!date) return prev;
  const time = prev.slice(11, 16) || '00:00';
  return `${date}T${time}`;
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
      counterparty: event.counterparty ?? '',
      online: event.isOnline,
      description: event.description ?? '',
      visibility: event.visibility,
      participants: [],
      allDay: event.allDay,
      timezone: event.timezone || DEFAULT_TIMEZONE,
      rrulePreset: matchRrulePreset(event.rrule),
      rruleRaw: event.rrule ?? '',
      reminders: event.reminders.map((r) => ({
        offsetMin: r.offsetMin,
        channel: r.channel,
      })),
    };
  }
  const base = defaultStartAt ?? new Date();
  const rounded = new Date(base);
  rounded.setMinutes(Math.ceil(rounded.getMinutes() / 30) * 30, 0, 0);
  const endDefault = new Date(rounded.getTime() + 30 * 60 * 1000);
  return {
    title: '',
    kind: 'meeting',
    startAt: toLocalInputValue(rounded),
    endAt: toLocalInputValue(endDefault),
    location: '',
    counterparty: '',
    online: false,
    description: '',
    visibility: 'company',
    participants: [],
    allDay: false,
    timezone: DEFAULT_TIMEZONE,
    rrulePreset: '',
    rruleRaw: '',
    reminders: [],
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
  const [makingOnline, setMakingOnline] = useState(false);
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

  function addReminder(): void {
    setState((s) =>
      s.reminders.length >= MAX_REMINDERS
        ? s
        : {
            ...s,
            reminders: [...s.reminders, { offsetMin: 15, channel: 'push' }],
          },
    );
  }

  function updateReminder(index: number, patch: Partial<ReminderDraft>): void {
    setState((s) => ({
      ...s,
      reminders: s.reminders.map((r, i) =>
        i === index ? { ...r, ...patch } : r,
      ),
    }));
  }

  function removeReminder(index: number): void {
    setState((s) => ({
      ...s,
      reminders: s.reminders.filter((_, i) => i !== index),
    }));
  }

  function resolveRrule(): string {
    if (state.rrulePreset === RRULE_CUSTOM_SENTINEL) return state.rruleRaw;
    return state.rrulePreset;
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
      const rrule = resolveRrule();

      if (isEdit && event) {
        const patch: UpdateEventRequestApi = {
          title: state.title.trim(),
          kind: state.kind,
          startAt: startIso,
          endAt: endIso ?? null,
          visibility: state.visibility,
          location: state.location.trim() ? state.location.trim() : null,
          counterparty: state.counterparty.trim()
            ? state.counterparty.trim()
            : null,
          online: state.online,
          description: state.description.trim()
            ? state.description.trim()
            : null,
          allDay: state.allDay,
          timezone: state.timezone,
          rrule: rrule ? rrule : null,
        };
        await calendarApi.updateEvent(event.id, patch);
      } else {
        const body: CreateEventRequestApi = {
          title: state.title.trim(),
          kind: state.kind,
          startAt: startIso,
          visibility: state.visibility,
          allDay: state.allDay,
          timezone: state.timezone,
          online: state.online,
          ...(endIso ? { endAt: endIso } : {}),
          ...(state.location.trim() ? { location: state.location.trim() } : {}),
          ...(state.counterparty.trim()
            ? { counterparty: state.counterparty.trim() }
            : {}),
          ...(state.description.trim()
            ? { description: state.description.trim() }
            : {}),
          ...(rrule ? { rrule } : {}),
          ...(projectId ? { projectId } : {}),
        };
        const participants = buildParticipantsPayload();
        if (participants.length > 0) body.participants = participants;
        if (state.reminders.length > 0) {
          body.reminders = state.reminders.map<ReminderInputApi>((r) => ({
            offsetMin: r.offsetMin,
            channel: r.channel,
          }));
        }
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

  async function handleMakeOnline(): Promise<void> {
    if (!event || makingOnline) return;
    setMakingOnline(true);
    setError(null);
    try {
      await calendarApi.makeEventOnline(event.id);
      toast.success('Видеокомната создана');
      onSaved();
      onClose();
    } catch (e2) {
      setError(humanizeApiError(e2, 'Не удалось создать видеокомнату.'));
    } finally {
      setMakingOnline(false);
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

          <label className="flex items-center gap-2 text-sm text-fg-secondary">
            <Checkbox
              checked={state.allDay}
              onCheckedChange={(c) => setField('allDay', c === true)}
            />
            <span>Весь день</span>
          </label>

          <div className="flex items-start justify-between gap-3 rounded-md border border-border-subtle bg-bg-overlay px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-sm font-medium text-fg-primary">
                Онлайн-встреча (создать видеокомнату)
              </div>
              <p className="mt-0.5 text-xs text-fg-tertiary">
                Включите для созвона по видео. Для очной встречи оставьте
                выключенным — комната не создаётся.
              </p>
            </div>
            <Switch
              checked={state.online}
              onCheckedChange={(v) => setField('online', v)}
              aria-label="Онлайн-встреча (создать видеокомнату)"
              className="mt-0.5 shrink-0"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="event-start">Начало *</Label>
              {state.allDay ? (
                <Input
                  id="event-start"
                  type="date"
                  value={dateOnly(state.startAt)}
                  onChange={(e) =>
                    setField('startAt', withDate(state.startAt, e.target.value))
                  }
                  required
                />
              ) : (
                <Input
                  id="event-start"
                  type="datetime-local"
                  value={state.startAt}
                  onChange={(e) => setField('startAt', e.target.value)}
                  required
                />
              )}
            </div>
            <div>
              <Label htmlFor="event-end">
                Окончание{requiresEndAt ? ' *' : ''}
              </Label>
              {state.allDay ? (
                <Input
                  id="event-end"
                  type="date"
                  value={dateOnly(state.endAt)}
                  onChange={(e) =>
                    setField('endAt', withDate(state.endAt, e.target.value))
                  }
                  {...(requiresEndAt ? { required: true } : {})}
                />
              ) : (
                <Input
                  id="event-end"
                  type="datetime-local"
                  value={state.endAt}
                  onChange={(e) => setField('endAt', e.target.value)}
                  {...(requiresEndAt ? { required: true } : {})}
                />
              )}
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
            <Label htmlFor="event-counterparty">Клиент/контрагент</Label>
            <Input
              id="event-counterparty"
              value={state.counterparty}
              onChange={(e) => setField('counterparty', e.target.value)}
              placeholder="Напр. Александр, молочный завод"
              maxLength={300}
            />
            <p className="mt-1 text-xs text-fg-tertiary">
              С кем встреча / какая компания — НЕ адрес.
            </p>
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="event-rrule">Повторение</Label>
              <select
                id="event-rrule"
                value={state.rrulePreset}
                onChange={(e) => setField('rrulePreset', e.target.value)}
                className={SELECT_CLASS}
              >
                {RRULE_PRESETS.map((p) => (
                  <option key={p.value || 'none'} value={p.value}>
                    {p.label}
                  </option>
                ))}
                {state.rrulePreset === RRULE_CUSTOM_SENTINEL && (
                  <option value={RRULE_CUSTOM_SENTINEL} disabled>
                    Другое (заданное правило)
                  </option>
                )}
              </select>
            </div>
            <div>
              <Label htmlFor="event-timezone">Часовой пояс</Label>
              <select
                id="event-timezone"
                value={state.timezone}
                onChange={(e) => setField('timezone', e.target.value)}
                className={SELECT_CLASS}
              >
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
                {!TIMEZONE_OPTIONS.some((tz) => tz.value === state.timezone) && (
                  <option value={state.timezone} disabled>
                    {state.timezone}
                  </option>
                )}
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label>Напоминания</Label>
              {!isEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={addReminder}
                  disabled={state.reminders.length >= MAX_REMINDERS}
                >
                  + Напоминание
                </Button>
              )}
            </div>

            {state.reminders.length === 0 ? (
              <p className="mt-1 text-xs text-fg-tertiary">
                {isEdit
                  ? 'Напоминания не настроены.'
                  : 'Напоминаний нет. Добавьте, чтобы получить уведомление заранее.'}
              </p>
            ) : isEdit ? (
              <ul className="mt-2 space-y-1 text-sm text-fg-secondary">
                {state.reminders.map((r, i) => (
                  <li
                    key={`${r.offsetMin}-${r.channel}-${i}`}
                    className="flex items-center gap-2"
                  >
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-fg-tertiary" />
                    <span>
                      {REMINDER_OFFSET_OPTIONS.find(
                        (o) => o.value === r.offsetMin,
                      )?.label ?? `За ${r.offsetMin} мин`}{' '}
                      · {REMINDER_CHANNEL_LABELS[r.channel]}
                    </span>
                  </li>
                ))}
                <li className="text-xs text-fg-tertiary">
                  Напоминания меняются только при пересоздании события.
                </li>
              </ul>
            ) : (
              <div className="mt-2 space-y-2">
                {state.reminders.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      value={r.offsetMin}
                      onChange={(e) =>
                        updateReminder(i, { offsetMin: Number(e.target.value) })
                      }
                      className={SELECT_CLASS}
                      aria-label="Время напоминания"
                    >
                      {REMINDER_OFFSET_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={r.channel}
                      onChange={(e) =>
                        updateReminder(i, {
                          channel: e.target.value as ReminderChannelApi,
                        })
                      }
                      className={SELECT_CLASS}
                      aria-label="Канал напоминания"
                    >
                      {REMINDER_CHANNEL_OPTIONS.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeReminder(i)}
                      aria-label="Удалить напоминание"
                    >
                      ×
                    </Button>
                  </div>
                ))}
              </div>
            )}
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

          {isEdit && event && !state.online && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleMakeOnline()}
              disabled={makingOnline || saving || deleting}
            >
              {makingOnline ? 'Создаём комнату…' : 'Сделать онлайн'}
            </Button>
          )}

          <DialogFooter className="gap-2">
            {isEdit && (
              <Button
                type="button"
                variant="destructive"
                onClick={() => void handleDelete()}
                disabled={deleting || saving || makingOnline}
              >
                {deleting ? 'Удаление…' : 'Удалить'}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={saving || deleting || makingOnline}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={saving || deleting || makingOnline}>
              {saving ? 'Сохранение…' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
