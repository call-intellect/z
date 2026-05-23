'use client';

import { useEffect, useState } from 'react';

import {
  operationsDashboardApi,
  type OperationsOverviewApi,
} from '@/api/operations-dashboard.api';
import { ApiError } from '@/api/api-error';

/**
 * SBA β-8 — клиентский COO-дашборд.
 *
 * Показывает агрегат `/api/v1/dashboard/operations/overview`:
 *   - кол-во активных блокеров (с разбивкой по severity);
 *   - missed goals + cascade-missed;
 *   - team friction count;
 *   - средний % загрузки + перегруженные сотрудники;
 *   - топ-5 свежих блокеров / team frictions.
 *
 * Без Recharts (пакет не подключён к проекту) — простой grid из «карточек».
 * Для визуализации severity используем CSS-плашки. Когда Recharts добавят
 * в `package.json` — переделаем на BarChart / PieChart.
 */
export function OperationsDashboardClient() {
  const [data, setData] = useState<OperationsOverviewApi | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    operationsDashboardApi
      .getOverview()
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.code === 'forbidden') {
          setError('Нет доступа к COO-дашборду (нужна роль coo / admin / owner).');
        } else {
          setError(
            err instanceof Error ? err.message : 'Не удалось загрузить дашборд',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <div className="p-6 text-sm text-gray-500">Загрузка дашборда…</div>;
  }
  if (error) {
    return (
      <div className="p-6">
        <h1 className="mb-2 text-2xl font-semibold">Операции</h1>
        <p className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </p>
      </div>
    );
  }
  if (!data) {
    return <div className="p-6 text-sm text-gray-500">Нет данных</div>;
  }

  return (
    <div className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Операции — пульс компании</h1>
        <p className="text-sm text-gray-500">
          Обновлено {new Date(data.generatedAt).toLocaleString('ru-RU')}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card
          title="Активные блокеры"
          value={data.blockersCount}
          accent={data.blockersBySeverity.high > 0 ? 'red' : 'amber'}
          subtitle={`high: ${data.blockersBySeverity.high}, medium: ${data.blockersBySeverity.medium}, low: ${data.blockersBySeverity.low}`}
        />
        <Card
          title="Провалившиеся цели"
          value={data.missedGoalsCount}
          accent={data.missedGoalsCount > 0 ? 'red' : 'green'}
          subtitle={`каскад: ${data.cascadeMissedCount}`}
        />
        <Card
          title="Конфликты в команде"
          value={data.teamFrictionCount}
          accent={data.teamFrictionCount > 0 ? 'amber' : 'green'}
          subtitle="EntityLink relationType=conflicted_with"
        />
        <Card
          title="Средняя загрузка"
          value={`${data.capacityAvgPercent}%`}
          accent={data.capacityOverloadedCount > 0 ? 'amber' : 'green'}
          subtitle={`перегружены: ${data.capacityOverloadedCount}`}
        />
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Свежие блокеры</h2>
        {data.topRecentBlockers.length === 0 ? (
          <p className="text-sm text-gray-500">Сейчас активных блокеров нет.</p>
        ) : (
          <ul className="divide-y rounded border bg-white">
            {data.topRecentBlockers.map((b) => (
              <li key={b.id} className="p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex-1">{b.text}</span>
                  <SeverityBadge severity={b.severity} />
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  {b.ownerPersonName ?? 'без владельца'} ·{' '}
                  {new Date(b.createdAt).toLocaleString('ru-RU')}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Свежие конфликты</h2>
        {data.topRecentTeamFrictions.length === 0 ? (
          <p className="text-sm text-gray-500">
            На текущий момент конфликтов в команде не зафиксировано.
          </p>
        ) : (
          <ul className="divide-y rounded border bg-white">
            {data.topRecentTeamFrictions.map((f) => (
              <li key={f.id} className="p-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-2">
                  <strong>{f.fromPersonName ?? 'неизвестный'}</strong>
                  <span className="text-gray-400">↔</span>
                  <strong>{f.toPersonName ?? 'неизвестный'}</strong>
                  <span className="text-xs text-gray-500">
                    ({Math.round(f.confidence * 100)}% уверенности)
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-600">{f.explanation}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Card(props: {
  title: string;
  value: number | string;
  accent: 'green' | 'amber' | 'red';
  subtitle?: string;
}) {
  const colour =
    props.accent === 'red'
      ? 'border-red-300 bg-red-50'
      : props.accent === 'amber'
        ? 'border-amber-300 bg-amber-50'
        : 'border-emerald-300 bg-emerald-50';
  return (
    <div className={`rounded border p-4 ${colour}`}>
      <div className="text-xs uppercase tracking-wide text-gray-500">
        {props.title}
      </div>
      <div className="mt-1 text-3xl font-bold">{props.value}</div>
      {props.subtitle ? (
        <div className="mt-1 text-xs text-gray-600">{props.subtitle}</div>
      ) : null}
    </div>
  );
}

function SeverityBadge(props: {
  severity: 'low' | 'medium' | 'high' | 'unknown';
}) {
  const label =
    props.severity === 'high'
      ? 'высокая'
      : props.severity === 'medium'
        ? 'средняя'
        : props.severity === 'low'
          ? 'низкая'
          : 'неизв.';
  const colour =
    props.severity === 'high'
      ? 'bg-red-100 text-red-700'
      : props.severity === 'medium'
        ? 'bg-amber-100 text-amber-700'
        : props.severity === 'low'
          ? 'bg-blue-100 text-blue-700'
          : 'bg-gray-100 text-gray-600';
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${colour}`}>
      {label}
    </span>
  );
}
