'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { ApiError, humanizeApiError } from '@/api/api-error';
import { workProfileApi } from '@/api/work-profile.api';
import {
  mapWorkProfileDtoToDomain,
  type WorkProfileDomain,
} from '@/domain/work-profile';
import { TIMEZONE_OPTIONS } from '@/ui/calendar/timezone-options';
import { Button } from '@/ui/shadcn/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/shadcn/card';
import { Checkbox } from '@/ui/shadcn/checkbox';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';

/**
 * ТЗ assistant-calendar-master Ф8 — рабочий профиль пользователя.
 *
 * Таймзона + рабочие часы + рабочие дни. Помощник Коры использует их, чтобы
 * правильно понимать «сегодня/завтра» и предлагать слоты в рабочее время.
 * Загрузка/сохранение через `workProfileApi` (слой ApiDto→Domain→Ui).
 */

/** Дни недели для чекбоксов: значение по контракту (0=вс..6=сб), порядок Пн..Вс. */
const WEEKDAY_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: 'Пн' },
  { value: 2, label: 'Вт' },
  { value: 3, label: 'Ср' },
  { value: 4, label: 'Чт' },
  { value: 5, label: 'Пт' },
  { value: 6, label: 'Сб' },
  { value: 0, label: 'Вс' },
];

/** Единый стиль нативного select (как поля в форме события). */
const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-border-subtle bg-bg-overlay px-3 text-sm text-fg-primary focus:outline-none focus:ring-2 focus:ring-accent';

function clampHour(raw: string, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(23, Math.max(0, Math.trunc(n)));
}

export function WorkProfileSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<WorkProfileDomain | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const dto = await workProfileApi.get();
        if (!cancelled) setProfile(mapWorkProfileDtoToDomain(dto));
      } catch (err) {
        if (!cancelled) {
          toast.error(
            err instanceof ApiError
              ? humanizeApiError(err)
              : 'Не удалось загрузить рабочий профиль.',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function patch(next: Partial<WorkProfileDomain>): void {
    setProfile((p) => (p ? { ...p, ...next } : p));
  }

  function toggleDay(day: number, checked: boolean): void {
    setProfile((p) => {
      if (!p) return p;
      const set = new Set(p.workingDays);
      if (checked) set.add(day);
      else set.delete(day);
      return { ...p, workingDays: Array.from(set).sort((a, b) => a - b) };
    });
  }

  async function handleSave(): Promise<void> {
    if (!profile || saving) return;
    if (profile.workEndHour <= profile.workStartHour) {
      toast.error('Конец рабочего дня должен быть позже начала.');
      return;
    }
    setSaving(true);
    try {
      const updated = await workProfileApi.update({
        timezone: profile.timezone,
        workStartHour: profile.workStartHour,
        workEndHour: profile.workEndHour,
        workingDays: profile.workingDays,
      });
      setProfile(mapWorkProfileDtoToDomain(updated));
      toast.success('Рабочее время сохранено.');
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? humanizeApiError(err)
          : 'Не удалось сохранить. Попробуйте ещё раз.',
      );
    } finally {
      setSaving(false);
    }
  }

  // Часовой пояс из профиля может не входить в наш список — показываем его
  // отдельной disabled-опцией, чтобы select отрисовал текущее значение.
  const tzInList =
    !profile || TIMEZONE_OPTIONS.some((tz) => tz.value === profile.timezone);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Рабочее время</CardTitle>
        <CardDescription>
          Часовой пояс, рабочие дни и часы. Помощник Коры учитывает их, когда
          понимает «сегодня/завтра» и предлагает время для встреч.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-fg-tertiary">Загрузка…</p>
        ) : !profile ? (
          <p className="text-sm text-fg-tertiary">
            Не удалось загрузить рабочий профиль.
          </p>
        ) : (
          <div className="flex max-w-md flex-col gap-5">
            <div className="space-y-1.5">
              <Label htmlFor="work-timezone">Часовой пояс</Label>
              <select
                id="work-timezone"
                value={profile.timezone}
                onChange={(e) => patch({ timezone: e.target.value })}
                className={SELECT_CLASS}
              >
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
                {!tzInList && (
                  <option value={profile.timezone} disabled>
                    {profile.timezone}
                  </option>
                )}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="work-start">Начало рабочего дня</Label>
                <Input
                  id="work-start"
                  type="number"
                  min={0}
                  max={23}
                  value={profile.workStartHour}
                  onChange={(e) =>
                    patch({
                      workStartHour: clampHour(
                        e.target.value,
                        profile.workStartHour,
                      ),
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="work-end">Конец рабочего дня</Label>
                <Input
                  id="work-end"
                  type="number"
                  min={0}
                  max={23}
                  value={profile.workEndHour}
                  onChange={(e) =>
                    patch({
                      workEndHour: clampHour(
                        e.target.value,
                        profile.workEndHour,
                      ),
                    })
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Рабочие дни</Label>
              <div className="flex flex-wrap gap-3">
                {WEEKDAY_OPTIONS.map((d) => (
                  <label
                    key={d.value}
                    className="inline-flex items-center gap-2 text-sm text-fg-secondary"
                  >
                    <Checkbox
                      checked={profile.workingDays.includes(d.value)}
                      onCheckedChange={(c) => toggleDay(d.value, c === true)}
                    />
                    <span>{d.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <Button type="button" onClick={() => void handleSave()} disabled={saving}>
                {saving ? 'Сохраняем…' : 'Сохранить'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
