'use client';

/**
 * Карточка «Поведение команды» на org-дашборде (Фаза B §9.2).
 *
 * Загружает Org-aggregate за последние 30 дней (по умолчанию).
 * Показывает топ-3 доминирующих спикеров, средний % тишины,
 * краткое описание тренда.
 *
 * Доступ — owner / admin (бэк отдаёт 403 для других).
 */

import { useMemo, type JSX } from 'react';
import useSWR from 'swr';

import { behaviorMetricsApi } from '@/api/behavior-metrics.api';
import {
  behaviorOrgAggregateFromApi,
  type BehaviorOrgAggregateDomain,
} from '@/domain/behavior-metrics';

export function BehaviorTeamCard(): JSX.Element {
  const swr = useSWR(
    ['behavior-metrics', 'org-aggregate', '30d'],
    () => behaviorMetricsApi.getOrgAggregate({}),
    { revalidateOnFocus: false },
  );

  const data: BehaviorOrgAggregateDomain | null = useMemo(
    () => (swr.data ? behaviorOrgAggregateFromApi(swr.data) : null),
    [swr.data],
  );

  if (swr.isLoading && !data) {
    return (
      <section
        data-testid="behavior-team-card-loading"
        className="rounded-2xl border border-neutral-200 bg-white p-6"
      >
        <h3 className="text-base font-semibold text-neutral-900">Поведение команды</h3>
        <p className="mt-2 text-sm text-neutral-500">Загружаем…</p>
      </section>
    );
  }

  if (swr.error || !data) {
    return (
      <section
        data-testid="behavior-team-card-error"
        className="rounded-2xl border border-amber-200 bg-amber-50 p-6"
      >
        <h3 className="text-base font-semibold text-amber-900">Поведение команды</h3>
        <p className="mt-2 text-sm text-amber-800">
          Не удалось загрузить агрегированные метрики.
        </p>
      </section>
    );
  }

  if (data.meetingsCount === 0) {
    return (
      <section className="rounded-2xl border border-neutral-200 bg-white p-6">
        <h3 className="text-base font-semibold text-neutral-900">Поведение команды</h3>
        <p className="mt-2 text-sm text-neutral-500">
          За выбранный период встреч с метриками поведения пока нет.
        </p>
      </section>
    );
  }

  const top3 = [...data.participants]
    .sort((a, b) => b.avgSpeakingPercent - a.avgSpeakingPercent)
    .slice(0, 3);

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-neutral-900">Поведение команды</h3>
        <span className="text-xs text-neutral-500">за 30 дней</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Tile title="Встреч" value={String(data.meetingsCount)} />
        <Tile
          title="Средняя тишина"
          value={`${data.avgSilencePercent.toFixed(0)} %`}
        />
      </div>

      <div>
        <div className="text-sm font-medium text-neutral-800">Топ доминирующих</div>
        <ol className="mt-2 space-y-1">
          {top3.map((p, i) => (
            <li
              key={p.userId ?? `g-${i}`}
              className="flex items-center justify-between text-sm"
            >
              <span className="text-neutral-700">
                {i + 1}. {p.displayName}
              </span>
              <span className="text-neutral-500">
                {p.avgSpeakingPercent.toFixed(0)} %
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Tile({ title, value }: { title: string; value: string }): JSX.Element {
  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
      <div className="text-xs text-neutral-500">{title}</div>
      <div className="mt-1 text-lg font-semibold text-neutral-900">{value}</div>
    </div>
  );
}
