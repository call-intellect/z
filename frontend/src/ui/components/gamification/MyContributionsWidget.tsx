'use client';

import { useEffect, useState } from 'react';

import { ApiError } from '@/api/api-error';
import { gamificationApi } from '@/api/gamification.api';
import {
  contributionFromApi,
  ideasInDevLabel,
  streakLabel,
  thanksLabel,
  type Contribution,
} from '@/domain/contribution';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';

/**
 * T1 (2026-05-23) — компактный виджет «Мой вклад» (для `/me`, `/dashboard`).
 *
 * Показывает три цифры: идеи в работе, спасибо за неделю, текущий стрик
 * чек-инов. БЕЗ топа, БЕЗ сравнения с другими.
 */
export function MyContributionsWidget() {
  const [data, setData] = useState<Contribution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    gamificationApi
      .getMyContributions()
      .then((dto) => {
        if (!cancelled) {
          setData(contributionFromApi(dto));
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Не удалось загрузить мой вклад';
        setError(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Мой вклад</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-fg-secondary">Загрузка…</p>
        ) : error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : !data ? (
          <p className="text-sm text-fg-secondary">Данных пока нет.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricBlock
              label="Идеи в работе"
              value={data.snapshot.ideas.inDevelopment}
              hint={ideasInDevLabel(data.snapshot.ideas.inDevelopment)}
            />
            <MetricBlock
              label="Спасибо за неделю"
              value={data.snapshot.thanksReceivedThisWeek}
              hint={thanksLabel(data.snapshot.thanksReceivedThisWeek)}
            />
            <MetricBlock
              label="Стрик чек-инов"
              value={data.snapshot.checkinStreak.current}
              hint={streakLabel(data.snapshot.checkinStreak.current)}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MetricBlock({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border-subtle bg-bg-overlay p-3">
      <span className="text-xs uppercase tracking-wide text-fg-secondary">
        {label}
      </span>
      <span className="text-2xl font-semibold text-fg-primary">{value}</span>
      <span className="text-xs text-fg-secondary">{hint}</span>
    </div>
  );
}
