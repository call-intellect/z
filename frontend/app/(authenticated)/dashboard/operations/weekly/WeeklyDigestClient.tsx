'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

import { ApiError } from '@/api/api-error';
import {
  weeklyDigestApi,
  type WeeklyOperationsDigestApi,
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

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded border bg-white p-3">
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
        <p className="rounded border bg-white p-4 text-sm text-fg-secondary">
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
  return (
    <div className="space-y-6">
      <section className="rounded border bg-white p-4">
        <h2 className="text-lg font-semibold">Температура команды</h2>
        <p className="mt-1 text-sm text-fg-secondary">
          Всего чек-инов: {data.metrics.totalCheckIns}. Зелёных{' '}
          {pct(data.metrics.greenShare)}, жёлтых{' '}
          {pct(data.metrics.yellowShare)}, красных{' '}
          {pct(data.metrics.redShare)}.
        </p>
      </section>

      <section className="rounded border bg-white p-4">
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
        <section className="rounded border bg-white p-4">
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
        <section className="rounded border bg-white p-4">
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
        <section className="rounded border bg-white p-4">
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

      <section className="rounded border bg-white p-4">
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
