'use client';

import { useEffect, useState } from 'react';

import Link from 'next/link';

import { ApiError } from '@/api/api-error';
import { commitmentsApi, type OpenCommitmentsListApi } from '@/api/commitments.api';
import {
  operationsDashboardApi,
  type OperationsOverviewApi,
  type OperationsTeamTemperatureSummaryApi,
} from '@/api/operations-dashboard.api';

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
  const [commitments, setCommitments] =
    useState<OpenCommitmentsListApi | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      operationsDashboardApi.getOverview(),
      commitmentsApi.listOpen({ days: 14, limit: 100 }).catch(() => null),
    ])
      .then(([overview, openCommitments]) => {
        if (cancelled) return;
        setData(overview);
        setCommitments(openCommitments);
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
    return <div className="p-6 text-sm text-fg-secondary">Загрузка дашборда…</div>;
  }
  if (error) {
    return (
      <div className="p-6">
        <h1 className="mb-2 text-2xl font-semibold">Операции</h1>
        <p className="rounded border border-chip-danger-bg bg-chip-danger-bg p-4 text-sm text-chip-danger-fg">
          {error}
        </p>
      </div>
    );
  }
  if (!data) {
    return <div className="p-6 text-sm text-fg-secondary">Нет данных</div>;
  }

  return (
    <div className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Операции — пульс компании</h1>
        <p className="text-sm text-fg-secondary">
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

      <TeamTemperatureWidget summary={data.teamTemperature} />

      {commitments ? <OpenCommitmentsWidget data={commitments} /> : null}

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Свежие блокеры</h2>
        {data.topRecentBlockers.length === 0 ? (
          <p className="text-sm text-fg-secondary">Сейчас активных блокеров нет.</p>
        ) : (
          <ul className="divide-y rounded border bg-white">
            {data.topRecentBlockers.map((b) => (
              <li key={b.id} className="p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex-1">{b.text}</span>
                  <SeverityBadge severity={b.severity} />
                </div>
                <div className="mt-1 text-xs text-fg-secondary">
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
          <p className="text-sm text-fg-secondary">
            На текущий момент конфликтов в команде не зафиксировано.
          </p>
        ) : (
          <ul className="divide-y rounded border bg-white">
            {data.topRecentTeamFrictions.map((f) => (
              <li key={f.id} className="p-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-2">
                  <strong>{f.fromPersonName ?? 'неизвестный'}</strong>
                  <span className="text-fg-tertiary">↔</span>
                  <strong>{f.toPersonName ?? 'неизвестный'}</strong>
                  <span className="text-xs text-fg-secondary">
                    ({Math.round(f.confidence * 100)}% уверенности)
                  </span>
                </div>
                <p className="mt-1 text-xs text-fg-secondary">{f.explanation}</p>
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
      ? 'border-chip-danger-bg bg-chip-danger-bg'
      : props.accent === 'amber'
        ? 'border-chip-warning-bg bg-chip-warning-bg'
        : 'border-chip-success-bg bg-chip-success-bg';
  return (
    <div className={`rounded border p-4 ${colour}`}>
      <div className="text-xs uppercase tracking-wide text-fg-secondary">
        {props.title}
      </div>
      <div className="mt-1 text-3xl font-bold">{props.value}</div>
      {props.subtitle ? (
        <div className="mt-1 text-xs text-fg-secondary">{props.subtitle}</div>
      ) : null}
    </div>
  );
}

function TeamTemperatureWidget(props: {
  summary: OperationsTeamTemperatureSummaryApi;
}) {
  const s = props.summary;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const greenW = Math.round(s.greenShare * 100);
  const yellowW = Math.round(s.yellowShare * 100);
  const redW = Math.round(s.redShare * 100);

  const deltaLabel = (() => {
    if (s.redShareDelta == null) return null;
    const delta = Math.round(s.redShareDelta * 100);
    if (delta === 0) return 'без изменений';
    if (delta > 0) return `красных +${delta}% к прошлой неделе`;
    return `красных ${delta}% к прошлой неделе`;
  })();

  return (
    <section className="mt-8 rounded border bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">
          Температура команды (последние {s.days} дн.)
        </h2>
        <Link
          href="/dashboard/operations/weekly"
          className="text-xs text-info hover:underline"
        >
          Открыть недельную сводку →
        </Link>
      </div>
      {s.totalCheckIns === 0 ? (
        <p className="mt-2 text-sm text-fg-secondary">
          За последние {s.days} дней нет чек-инов с проанализированным
          настроением. Когда сотрудники начнут отвечать на вечерние чек-ины
          — здесь появится распределение зелёный / жёлтый / красный.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-fg-secondary">
            Всего чек-инов: {s.totalCheckIns}
            {deltaLabel ? `; ${deltaLabel}.` : '.'}
          </p>
          <div className="mt-3 flex h-6 overflow-hidden rounded border">
            {greenW > 0 ? (
              <div
                className="bg-success"
                style={{ width: `${greenW}%` }}
                title={`зелёных ${pct(s.greenShare)}`}
              />
            ) : null}
            {yellowW > 0 ? (
              <div
                className="bg-warning"
                style={{ width: `${yellowW}%` }}
                title={`жёлтых ${pct(s.yellowShare)}`}
              />
            ) : null}
            {redW > 0 ? (
              <div
                className="bg-danger"
                style={{ width: `${redW}%` }}
                title={`красных ${pct(s.redShare)}`}
              />
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-fg-secondary">
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded bg-success" />
              зелёных {pct(s.greenShare)}
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded bg-warning" />
              жёлтых {pct(s.yellowShare)}
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded bg-danger" />
              красных {pct(s.redShare)}
            </span>
          </div>
        </>
      )}
    </section>
  );
}

function OpenCommitmentsWidget(props: { data: OpenCommitmentsListApi }) {
  const { items, total } = props.data;
  // Группируем по автору, чтобы COO видел «кто сколько висит».
  const groups = new Map<string, OpenCommitmentsListApi['items']>();
  for (const c of items) {
    const key = c.authorPersonName ?? 'без автора';
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }
  const groupList = Array.from(groups.entries()).sort(
    (a, b) => b[1].length - a[1].length,
  );
  return (
    <section className="mt-8 rounded border bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">
          Открытые обещания за 14 дней
        </h2>
        <span className="text-sm text-fg-secondary">всего: {total}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-fg-secondary">
          Висящих обещаний нет — все закрыты или сроки ещё не наступили.
        </p>
      ) : (
        <ul className="divide-y">
          {groupList.map(([author, list]) => (
            <li key={author} className="py-2">
              <div className="text-sm font-medium">
                {author}
                <span className="ml-2 text-xs text-fg-secondary">
                  ({list.length})
                </span>
              </div>
              <ul className="mt-1 ml-3 list-disc text-xs text-fg-secondary">
                {list.slice(0, 5).map((c) => (
                  <li key={c.id} className="py-0.5">
                    {c.text}
                    {c.dueDate ? (
                      <span className="ml-1 text-fg-tertiary">
                        (срок {new Date(c.dueDate).toLocaleDateString('ru-RU')})
                      </span>
                    ) : null}
                    {c.escalatedAt ? (
                      <span className="ml-1 rounded bg-chip-danger-bg px-1.5 py-0.5 text-[10px] text-chip-danger-fg">
                        давно молчит
                      </span>
                    ) : c.askedAt ? (
                      <span className="ml-1 rounded bg-chip-warning-bg px-1.5 py-0.5 text-[10px] text-chip-warning-fg">
                        спросили
                      </span>
                    ) : null}
                  </li>
                ))}
                {list.length > 5 ? (
                  <li className="py-0.5 text-fg-tertiary">
                    …и ещё {list.length - 5}
                  </li>
                ) : null}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
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
      ? 'bg-chip-danger-bg text-chip-danger-fg'
      : props.severity === 'medium'
        ? 'bg-chip-warning-bg text-chip-warning-fg'
        : props.severity === 'low'
          ? 'bg-chip-info-bg text-chip-info-fg'
          : 'bg-bg-subtle text-fg-secondary';
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${colour}`}>
      {label}
    </span>
  );
}
