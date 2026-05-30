'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

import { ApiError } from '@/api/api-error';
import {
  weeklyDigestApi,
  type WeeklyForecastItemApi,
  type WeeklyKpiDeltaApi,
  type WeeklyOperationsDigestApi,
  type WeeklyTeamDynamicsRowApi,
} from '@/api/weekly-digest.api';

/**
 * SBA β-8.1 — клиентский UI «Недельной сводки операционного директора».
 *
 * Показывает дайджест `WeeklyOperationsDigest` за указанную неделю.
 * `weekStart` берётся из query-параметра `?weekStart=YYYY-MM-DD`;
 * если не задан — используем понедельник прошедшей недели (по UTC).
 *
 * Навигация по неделям — кнопки «← Прошлая» / «Следующая →» (с проверкой
 * на будущее: следующую неделю не запрашиваем).
 */
export function WeeklyDigestClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialWeek = searchParams?.get('weekStart') ?? defaultLastMondayUtc();
  const [weekStart, setWeekStart] = useState(initialWeek);
  const [data, setData] = useState<WeeklyOperationsDigestApi | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    weeklyDigestApi
      .get(weekStart)
      .then((res) => {
        if (cancelled) return;
        setData(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setData(null);
        if (err instanceof ApiError && err.code === 'digest_not_found') {
          setError(
            'Дайджест за выбранную неделю ещё не сгенерирован. Он появится в понедельник утром по локальному времени организации.',
          );
        } else if (err instanceof ApiError && err.code === 'forbidden_role') {
          setError(
            'Нет доступа к недельной сводке (нужна роль coo / admin / owner).',
          );
        } else {
          setError(
            err instanceof Error
              ? err.message
              : 'Не удалось загрузить недельную сводку',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [weekStart]);

  const goToWeek = (nextWeek: string) => {
    setWeekStart(nextWeek);
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('weekStart', nextWeek);
    router.replace(`/dashboard/operations/weekly?${params.toString()}`);
  };

  const prevWeek = shiftDate(weekStart, -7);
  const nextWeek = shiftDate(weekStart, 7);
  const today = todayUtcDate();
  const nextWeekDisabled = nextWeek > today;

  return (
    <div className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Недельная сводка</h1>
        <p className="text-sm text-fg-secondary">
          Обзор для операционного директора: температура команды,
          повторяющиеся блокеры, сигналы, цели, висящие решения.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded border bg-bg-card p-3">
        <button
          type="button"
          onClick={() => goToWeek(prevWeek)}
          className="rounded border px-3 py-1 text-sm hover:bg-bg-subtle"
        >
          ← Прошлая неделя
        </button>
        <div className="text-sm">
          <span className="text-fg-secondary">Неделя с </span>
          <strong>{formatRu(weekStart)}</strong>
          {data ? (
            <>
              <span className="text-fg-secondary"> по </span>
              <strong>{formatRu(data.weekEnd)}</strong>
            </>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => goToWeek(nextWeek)}
          disabled={nextWeekDisabled}
          className="rounded border px-3 py-1 text-sm hover:bg-bg-subtle disabled:opacity-50"
        >
          Следующая неделя →
        </button>
      </div>

      {loading ? (
        <p className="rounded border bg-bg-card p-4 text-sm text-fg-secondary">
          Загрузка сводки…
        </p>
      ) : error ? (
        <p className="rounded border border-chip-warning-bg bg-chip-warning-bg p-4 text-sm text-chip-warning-fg">
          {error}
        </p>
      ) : data ? (
        <DigestView data={data} />
      ) : null}
    </div>
  );
}

function DigestView(props: { data: WeeklyOperationsDigestApi }) {
  const { data } = props;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  // Pulse Wave 2 §2.2 — default `?? []` страхует от старых ответов API.
  const kpiDeltas = data.kpiDeltas ?? [];
  const teamDynamics = data.teamDynamics ?? [];
  const forecast = data.forecast ?? [];
  return (
    <div className="space-y-6">
      {/* Pulse Wave 2 §2.2 — 4 KPI с дельтами наверху для быстрого «пульса». */}
      <KpiDeltasSection items={kpiDeltas} />
      <TeamDynamicsSection items={teamDynamics} />
      <ForecastSection items={forecast} />

      <section className="rounded border bg-bg-card p-4">
        <h2 className="text-lg font-semibold">Температура команды</h2>
        <p className="mt-1 text-sm text-fg-secondary">
          Всего чек-инов: {data.metrics.totalCheckIns}. Зелёных{' '}
          {pct(data.metrics.greenShare)}, жёлтых{' '}
          {pct(data.metrics.yellowShare)}, красных{' '}
          {pct(data.metrics.redShare)}.
        </p>
      </section>

      <section className="rounded border bg-bg-card p-4">
        <h2 className="text-lg font-semibold">Цели за неделю</h2>
        <p className="mt-1 text-sm text-fg-secondary">
          Закрыто: {data.metrics.goals.completed} (
          {signedRu(data.metrics.goals.completedDelta)} к прошлой неделе).
          Провалено: {data.metrics.goals.failed} (
          {signedRu(data.metrics.goals.failedDelta)}). В работе:{' '}
          {data.metrics.goals.inProgress}.
        </p>
      </section>

      {data.metrics.topBlockers.length > 0 ? (
        <section className="rounded border bg-bg-card p-4">
          <h2 className="text-lg font-semibold">Повторяющиеся блокеры</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {data.metrics.topBlockers.map((b, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-fg-tertiary">·</span>
                <span className="flex-1">{b.text}</span>
                <span className="text-xs text-fg-secondary">
                  упоминаний: {b.count}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.metrics.topInsights.length > 0 ? (
        <section className="rounded border bg-bg-card p-4">
          <h2 className="text-lg font-semibold">Главные сигналы</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {data.metrics.topInsights.map((it) => (
              <li key={it.insightId} className="flex items-start gap-2">
                <span className="rounded bg-bg-subtle px-2 py-0.5 text-xs text-fg-secondary">
                  {it.kind}
                </span>
                <span className="flex-1">{it.statement}</span>
                <span className="text-xs text-fg-secondary">
                  динамика: {it.dynamicLabel}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.metrics.hangingDecisions.length > 0 ? (
        <section className="rounded border bg-bg-card p-4">
          <h2 className="text-lg font-semibold">Висящие решения</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {data.metrics.hangingDecisions.map((d) => (
              <li key={d.decisionId} className="flex items-start gap-2">
                <span className="text-fg-tertiary">·</span>
                <span className="flex-1">{d.statement}</span>
                <span className="text-xs text-fg-secondary">
                  возраст: {d.ageDays} дн.
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded border bg-bg-card p-4">
        <h2 className="text-lg font-semibold">Комментарий</h2>
        <p className="mt-1 text-xs text-fg-secondary">
          Связный текст автоматически собран по показателям выше.
        </p>
        <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-6 text-fg-primary">
          {data.bodyMarkdown}
        </pre>
      </section>

      <p className="text-xs text-fg-tertiary">
        Сгенерировано {new Date(data.createdAt).toLocaleString('ru-RU')}
        {data.llmTaskRouteId ? ` · модель: ${data.llmTaskRouteId}` : ' · автоматически (без LLM)'}.
      </p>
    </div>
  );
}

function defaultLastMondayUtc(): string {
  const d = new Date();
  // 0 = воскресенье, 1 = понедельник, ..., 6 = суббота.
  const dow = d.getUTCDay();
  // Вычисляем понедельник прошедшей недели (если сегодня пн, то -7 дней).
  const offset = dow === 0 ? -13 : -(dow - 1) - 7;
  const monday = new Date(d);
  monday.setUTCDate(monday.getUTCDate() + offset);
  return toIso(monday);
}

function shiftDate(dateLocal: string, days: number): string {
  const d = new Date(`${dateLocal}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

function todayUtcDate(): string {
  return toIso(new Date());
}

function toIso(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function formatRu(dateLocal: string): string {
  // YYYY-MM-DD → DD.MM.YYYY.
  const [y, m, d] = dateLocal.split('-');
  return `${d}.${m}.${y}`;
}

function signedRu(v: number): string {
  if (v > 0) return `+${v}`;
  return String(v);
}

/* ──────────────────────────────────────────────────────────────────────
 * Pulse Wave 2 §2.2 — секции «KPI с дельтами / Динамика команд / Прогноз».
 * Цвета — парные токены `chip-{role}-bg` + `chip-{role}-fg`. Без hex.
 * ────────────────────────────────────────────────────────────────────── */

function KpiDeltasSection({ items }: { items: WeeklyKpiDeltaApi[] }) {
  if (items.length === 0) return null;
  return (
    <section className="rounded border bg-bg-card p-4">
      <h2 className="mb-3 text-lg font-semibold">Главные показатели</h2>
      <p className="mb-3 text-xs text-fg-tertiary">
        Сравнение с прошлой неделей.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((k) => (
          <KpiDeltaCard key={k.label} k={k} />
        ))}
      </div>
    </section>
  );
}

function KpiDeltaCard({ k }: { k: WeeklyKpiDeltaApi }) {
  const direction =
    k.delta === null ? 'flat' : k.delta > 0 ? 'up' : k.delta < 0 ? 'down' : 'flat';
  // Для висящих решений рост — это плохо, а падение хорошо. Для остальных —
  // наоборот. UI-цвет считаем по «направлению хорошо/плохо».
  const isInverse = k.label === 'Висящие решения';
  const isGood =
    direction === 'flat'
      ? null
      : isInverse
      ? direction === 'down'
      : direction === 'up';
  const tone =
    isGood === null
      ? 'neutral'
      : isGood
      ? 'success'
      : 'danger';
  const chipClass =
    tone === 'success'
      ? 'bg-chip-success-bg text-chip-success-fg'
      : tone === 'danger'
      ? 'bg-chip-danger-bg text-chip-danger-fg'
      : 'bg-bg-subtle text-fg-secondary';
  const arrow = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '·';
  const unitSuffix = k.unit === '%' ? '%' : k.unit === 'pts' ? ' pts' : ' шт';
  return (
    <div className="rounded border border-border-subtle bg-bg-surface p-3">
      <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
        {k.label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums text-fg-primary">
          {k.current}
          <span className="ml-0.5 text-sm font-normal text-fg-secondary">
            {unitSuffix}
          </span>
        </span>
        {k.delta !== null ? (
          <span
            className={`rounded px-2 py-0.5 text-[11px] tabular-nums ${chipClass}`}
            title={
              k.previous !== null
                ? `Прошлая неделя: ${k.previous}${unitSuffix}`
                : undefined
            }
          >
            {arrow} {signedRu(k.delta)}
            {k.unit === '%' || k.unit === 'pts' ? '' : ''}
          </span>
        ) : (
          <span className="rounded bg-bg-subtle px-2 py-0.5 text-[11px] text-fg-tertiary">
            нет данных
          </span>
        )}
      </div>
    </div>
  );
}

function TeamDynamicsSection({
  items,
}: {
  items: WeeklyTeamDynamicsRowApi[];
}) {
  if (items.length === 0) return null;
  return (
    <section className="rounded border bg-bg-card p-4">
      <h2 className="mb-3 text-lg font-semibold">Динамика команд</h2>
      <p className="mb-3 text-xs text-fg-tertiary">
        Команды, которые заметно изменились за неделю.
      </p>
      <ul className="space-y-1">
        {items.map((row) => {
          const isImproved =
            row.signal === 'sentiment_improved' ||
            row.signal === 'promises_improved';
          const chipClass = isImproved
            ? 'bg-chip-success-bg text-chip-success-fg'
            : 'bg-chip-danger-bg text-chip-danger-fg';
          return (
            <li
              key={`${row.departmentId}-${row.signal}`}
              className="flex flex-wrap items-center gap-2 rounded-md p-2 text-sm hover:bg-bg-subtle"
            >
              <span aria-hidden className={isImproved ? 'text-chip-success-fg' : 'text-chip-danger-fg'}>
                {isImproved ? '↑' : '↓'}
              </span>
              <span className="font-medium text-fg-primary">
                {row.departmentName}
              </span>
              <span className={`rounded px-2 py-0.5 text-[11px] ${chipClass}`}>
                {teamDynamicsLabel(row.signal)}
              </span>
              <span className="flex-1 truncate text-xs text-fg-secondary">
                {row.detail}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function teamDynamicsLabel(
  signal: WeeklyTeamDynamicsRowApi['signal'],
): string {
  switch (signal) {
    case 'sentiment_improved':
      return 'настроение улучшилось';
    case 'sentiment_dropped':
      return 'настроение упало';
    case 'promises_improved':
      return 'обещания выправились';
    case 'promises_dropped':
      return 'обещания просели';
    default:
      return signal;
  }
}

function ForecastSection({ items }: { items: WeeklyForecastItemApi[] }) {
  if (items.length === 0) return null;
  return (
    <section className="rounded border bg-bg-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Прогноз на следующую неделю</h2>
        <span className="text-xs text-fg-tertiary">
          линейная экстраполяция тренда
        </span>
      </div>
      <ul className="space-y-2">
        {items.map((f) => {
          const chipClass =
            f.confidence === 'medium'
              ? 'bg-chip-info-bg text-chip-info-fg'
              : 'bg-bg-subtle text-fg-secondary';
          return (
            <li key={f.metric} className="rounded-md p-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-bg-subtle px-2 py-0.5 text-[11px] text-fg-secondary">
                  {forecastMetricLabel(f.metric)}
                </span>
                <span
                  className={`rounded px-2 py-0.5 text-[11px] ${chipClass}`}
                  title="Уверенность прогноза: medium — заметный тренд (≥10), low — слабый или нет данных"
                >
                  {f.confidence === 'medium' ? 'уверенность средняя' : 'уверенность низкая'}
                </span>
              </div>
              <p className="mt-1 text-fg-primary">{f.projection}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function forecastMetricLabel(
  metric: WeeklyForecastItemApi['metric'],
): string {
  switch (metric) {
    case 'sentiment':
      return 'Настроение';
    case 'promises':
      return 'Обещания';
    case 'hanging_decisions':
      return 'Висящие решения';
    default:
      return metric;
  }
}
