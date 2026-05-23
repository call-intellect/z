'use client';

/**
 * Фаза A.3 — `/admin/prompts/experiments/[id]` — карточка эксперимента
 * с метриками A vs B и кнопками start/stop.
 *
 * Источник: ТЗ A §8.1.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '@/api/api-error';
import {
  type ExperimentAnalyticsApi,
  adminPromptExperimentsApi,
} from '@/api/admin-prompt-experiments.api';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { toast } from '@/ui/shadcn/toast';

interface Props {
  experimentId: string;
}

export function PromptExperimentDetailClient({ experimentId }: Props) {
  const [analytics, setAnalytics] = useState<ExperimentAnalyticsApi | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminPromptExperimentsApi.analytics(experimentId);
      setAnalytics(res);
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : 'Не удалось загрузить аналитику';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [experimentId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleStart = useCallback(async () => {
    setActing(true);
    try {
      await adminPromptExperimentsApi.start(experimentId);
      toast.success('Эксперимент запущен');
      await fetchData();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Не удалось запустить';
      toast.error('Ошибка', { description: msg });
    } finally {
      setActing(false);
    }
  }, [experimentId, fetchData]);

  const handleStop = useCallback(async () => {
    setActing(true);
    try {
      await adminPromptExperimentsApi.stop(experimentId, 'Остановлен из админки');
      toast.success('Эксперимент остановлен');
      await fetchData();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Не удалось остановить';
      toast.error('Ошибка', { description: msg });
    } finally {
      setActing(false);
    }
  }, [experimentId, fetchData]);

  if (loading) {
    return <div className="text-sm text-slate-500">Загрузка эксперимента…</div>;
  }

  if (error || !analytics) {
    return (
      <div className="rounded-md border border-rose-300 bg-rose-50 p-4 text-sm text-rose-800">
        {error ?? 'Эксперимент не найден'}
        <Link href="/admin/prompts/experiments" className="ml-2 underline">
          К списку
        </Link>
      </div>
    );
  }

  const e = analytics.experiment;
  const groupA = analytics.groups.find((g) => g.group === 'A');
  const groupB = analytics.groups.find((g) => g.group === 'B');

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <Link
            href="/admin/prompts/experiments"
            className="text-sm text-slate-500 hover:underline"
          >
            ← К списку экспериментов
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
            Эксперимент {e.id.slice(0, 8)}
          </h1>
          <div className="mt-2 flex items-center gap-2">
            <Badge>{statusLabel(e.status)}</Badge>
            <span className="text-sm text-slate-500">
              Доля трафика на группу B: {e.splitPercent}%
            </span>
            {e.orgId ? (
              <span className="text-sm text-slate-500">Org: {e.orgId.slice(0, 8)}</span>
            ) : (
              <span className="text-sm text-slate-500">Глобальный</span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {e.status === 'draft' ? (
            <Button onClick={() => void handleStart()} disabled={acting}>
              Запустить
            </Button>
          ) : null}
          {e.status === 'running' ? (
            <Button
              variant="destructive"
              onClick={() => void handleStop()}
              disabled={acting}
            >
              Остановить
            </Button>
          ) : null}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <GroupCard label="Группа A (контроль)" groupAnalytics={groupA} />
        <GroupCard label="Группа B (вариант)" groupAnalytics={groupB} />
      </div>

      {e.notes ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Комментарии</h2>
          <pre className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs text-slate-700">
            {e.notes}
          </pre>
        </section>
      ) : null}
    </div>
  );
}

function statusLabel(s: string): string {
  switch (s) {
    case 'draft':
      return 'Черновик';
    case 'running':
      return 'Запущен';
    case 'stopped':
      return 'Остановлен';
    case 'completed':
      return 'Завершён';
    default:
      return s;
  }
}

interface GroupAnalytics {
  group: 'A' | 'B';
  versionId: string;
  meetingsCount: number;
  positiveFeedback: number;
  negativeFeedback: number;
}

function GroupCard({
  label,
  groupAnalytics,
}: {
  label: string;
  groupAnalytics: GroupAnalytics | undefined;
}) {
  if (!groupAnalytics) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-4">
        <div className="text-sm font-medium text-slate-700">{label}</div>
        <div className="mt-2 text-xs text-slate-500">Нет данных</div>
      </div>
    );
  }
  const total = groupAnalytics.positiveFeedback + groupAnalytics.negativeFeedback;
  const positiveRatio =
    total > 0 ? (groupAnalytics.positiveFeedback / total) * 100 : null;
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="text-sm font-medium text-slate-700">{label}</div>
      <div className="mt-1 text-xs text-slate-500">
        Версия: {groupAnalytics.versionId.slice(0, 8)}
      </div>
      <dl className="mt-3 space-y-1 text-sm">
        <Row label="Встреч в группе" value={groupAnalytics.meetingsCount} />
        <Row label="👍 положительных" value={groupAnalytics.positiveFeedback} />
        <Row label="👎 отрицательных" value={groupAnalytics.negativeFeedback} />
        <Row
          label="Доля положительных"
          value={positiveRatio !== null ? `${positiveRatio.toFixed(1)}%` : '—'}
        />
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-800">{value}</dd>
    </div>
  );
}
