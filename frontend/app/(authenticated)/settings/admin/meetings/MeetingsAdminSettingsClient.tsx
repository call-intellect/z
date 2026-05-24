'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';

import { qualityScoreApi } from '@/api/quality-score.api';
import { orgQualityScoreSettingsFromApi } from '@/domain/quality-score';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';

/**
 * Клиент страницы `/settings/admin/meetings` (Фаза C §8.3).
 *
 * Содержит блок «Считать оценку для типов встреч» — чекбокс-список 9 типов.
 * Под капотом — `Org.qualityScoreDisabledForTypes`: ВЫКЛЮЧЕННЫЙ чекбокс
 * = тип в массиве disabled.
 *
 * Все строки на русском (memory `feedback_admin_ui_russian_only`).
 */

const MEETING_TYPES: Array<{ value: string; label: string }> = [
  { value: 'team', label: 'Командная встреча (team)' },
  { value: 'standup', label: 'Стендап (standup)' },
  { value: 'plan_fact', label: 'План-факт (plan_fact)' },
  { value: 'project', label: 'Проект (project)' },
  { value: 'sales', label: 'Продажи (sales)' },
  { value: 'custdev', label: 'Custdev' },
  { value: 'partner', label: 'Партнёр (partner)' },
  { value: 'interview', label: 'Интервью (interview)' },
  { value: 'customer_success', label: 'Customer Success' },
];

export function MeetingsAdminSettingsClient() {
  const swr = useSWR(
    ['org-quality-score-settings'],
    async () => {
      const dto = await qualityScoreApi.getOrgSettings();
      return orgQualityScoreSettingsFromApi(dto);
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const [disabled, setDisabled] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (swr.data && disabled === null) {
      setDisabled([...swr.data.disabledForTypes]);
    }
  }, [swr.data, disabled]);

  if (swr.isLoading && !swr.data) {
    return <div className="text-sm text-fg-secondary">Загрузка настроек…</div>;
  }

  if (swr.error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Настройки встреч</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-chip-warning-fg">
            Не удалось загрузить настройки. Доступ есть только у владельца и
            администраторов организации.
          </p>
        </CardContent>
      </Card>
    );
  }

  const currentDisabled = disabled ?? swr.data?.disabledForTypes ?? [];

  const toggle = (value: string): void => {
    setSuccess(null);
    setError(null);
    setDisabled((prev) => {
      const base = prev ?? [...(swr.data?.disabledForTypes ?? [])];
      return base.includes(value) ? base.filter((v) => v !== value) : [...base, value];
    });
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const dto = await qualityScoreApi.updateOrgSettings({
        disabledForTypes: currentDisabled,
      });
      setDisabled([...dto.disabledForTypes]);
      setSuccess('Настройки сохранены.');
      await swr.mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить настройки.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-fg-primary">Встречи</h1>
        <p className="text-sm text-fg-secondary">
          Настройки AI-оценки качества встреч для организации.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Считать оценку для типов встреч</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-fg-secondary">
            Снимите галочку с типов, для которых AI-оценка качества не нужна
            (например, custdev — это исследование, а не управленческая встреча).
          </p>
          <ul className="space-y-2">
            {MEETING_TYPES.map((t) => {
              const checked = !currentDisabled.includes(t.value);
              return (
                <li key={t.value} className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id={`mt-${t.value}`}
                    checked={checked}
                    onChange={() => toggle(t.value)}
                    className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
                  />
                  <label htmlFor={`mt-${t.value}`} className="text-sm text-fg-primary">
                    {t.label}
                  </label>
                </li>
              );
            })}
          </ul>
          {error ? (
            <p className="text-sm text-chip-danger-fg">{error}</p>
          ) : null}
          {success ? (
            <p className="text-sm text-chip-success-fg">{success}</p>
          ) : null}
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
