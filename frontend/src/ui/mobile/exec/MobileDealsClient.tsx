'use client';

/**
 * MobileDealsClient — мобильный экран «Дела» руководителя (ТЗ B2/Ф3
 * `2026-06-11-remaining-handoff-finishable-now.md` блок B; полный контракт —
 * `2026-06-11-mobile-cora-exec-manager.md` §Ф3).
 *
 * Инвариант №1: мобайл = тот же web-app, читает СУЩЕСТВУЮЩИЙ эндпоинт
 * `GET /dashboard/operations/weekly-per-person?weekStart=…` через тот же маппер
 * `weeklyPerPersonFromApi` → `WeeklyPerPersonUi`. Десктоп НЕ меняем.
 *
 * Раскладка (один столбец, glance):
 *   - «Команда держит слово» — крупный % (GlanceGauge);
 *   - «Кому помочь» — люди под угрозой по надёжности, поданные как нуждающиеся
 *     в поддержке (Р4: НЕ «провалил/просрочил»);
 *   - «Молодцы» — кто держит слово (позитив).
 *
 * Чистая логика (понедельник недели, агрегат, ряды) — в `deals-rows.ts`
 * (тестируется юнитом). Финансы НЕ показываем.
 */

import { useMemo } from 'react';
import useSWR from 'swr';
import { AlertCircle, CheckCircle2, HeartHandshake, Handshake } from 'lucide-react';

import { weeklyPerPersonApi } from '@/api/weekly-per-person.api';
import { humanizeApiError } from '@/api/api-error';
import { useAuth } from '@/contexts/auth-context';
import { weeklyPerPersonFromApi } from '@/domain/weekly-per-person';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { GlanceGauge } from '@/ui/mobile/shared/GlanceGauge';
import { DrillList } from '@/ui/mobile/shared/DrillList';
import {
  dealsHelpRows,
  dealsReliableRows,
  isDealsEmpty,
  reliabilityTone,
  teamAverageReliabilityPercent,
  weekStartMonday,
} from './deals-rows';

export function MobileDealsClient() {
  const { currentOrgId } = useAuth();

  // Понедельник текущей недели (YYYY-MM-DD). Считаем один раз за рендер-сессию,
  // чтобы SWR-ключ был стабилен (иначе каждый рендер → новый fetch).
  const weekStart = useMemo(() => weekStartMonday(new Date()), []);

  const swr = useSWR(
    currentOrgId ? ['mobile-deals', currentOrgId, weekStart] : null,
    async () => {
      const res = await weeklyPerPersonApi.get(weekStart, { limit: 5 });
      return weeklyPerPersonFromApi(res);
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const ui = swr.data ?? null;
  const loading = !!currentOrgId && swr.isLoading && !ui;
  const error = swr.error
    ? humanizeApiError(swr.error, 'Не удалось загрузить дела')
    : null;

  const avg = teamAverageReliabilityPercent(ui);
  const tone = reliabilityTone(avg);
  const help = dealsHelpRows(ui);
  const reliable = dealsReliableRows(ui);
  const empty = !loading && !error && isDealsEmpty(ui);

  return (
    <div className="mx-auto w-full max-w-md px-4 py-5">
      <h1 className="mb-1 flex items-center gap-2 text-xl font-semibold text-fg-primary">
        <Handshake size={20} className="text-accent" aria-hidden />
        Дела
      </h1>
      <p className="mb-4 text-sm text-fg-secondary">Держим ли слово — за эту неделю.</p>

      {loading && <DealsSkeleton />}

      {!loading && error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-chip-danger-bg p-3 text-sm text-chip-danger-fg">
          <AlertCircle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && empty && (
        <div
          data-testid="deals-empty"
          className="rounded-2xl border border-border-subtle bg-bg-card p-5 text-center"
        >
          <Handshake size={24} className="mx-auto mb-2 text-accent" aria-hidden />
          <p className="text-base font-medium text-fg-primary">Обещаний пока нет</p>
          <p className="mt-1 text-sm text-fg-secondary">
            Появятся договорённости из встреч и чатов — здесь покажем, как команда держит слово.
          </p>
        </div>
      )}

      {!loading && !error && !empty && (
        <>
          {/* Команда держит слово — крупный %. */}
          <div
            className="mb-5 flex flex-col items-center rounded-2xl border border-border-subtle bg-bg-card p-4"
            data-testid="deals-reliability"
          >
            <div className="mb-1 text-sm font-medium text-fg-secondary">
              Команда держит слово
            </div>
            <GlanceGauge percent={avg} />
            <div className="mt-1 text-xs text-fg-tertiary">
              {avg === null
                ? 'данных пока мало'
                : tone === 'ok'
                  ? 'надёжно'
                  : tone === 'warn'
                    ? 'есть над чем поработать'
                    : 'нужна поддержка команде'}
            </div>
          </div>

          {/* Кому помочь — под угрозой по надёжности. */}
          {help.length > 0 && (
            <section className="mb-4">
              <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-fg-secondary">
                <HeartHandshake size={15} className="text-accent" aria-hidden />
                Кому помочь
              </h2>
              <DrillList items={help} />
            </section>
          )}

          {/* Молодцы — держат слово. */}
          {reliable.length > 0 && (
            <section>
              <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-fg-secondary">
                <CheckCircle2 size={15} className="text-success" aria-hidden />
                Молодцы
              </h2>
              <DrillList items={reliable} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

function DealsSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-28 w-full rounded-2xl" />
      <Skeleton className="h-20 w-full rounded-2xl" />
      <Skeleton className="h-20 w-full rounded-2xl" />
    </div>
  );
}
