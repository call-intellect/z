'use client';

/**
 * MobileOverviewClient — мобильный экран «Обзор» руководителя (ТЗ B1/Ф2
 * `2026-06-11-remaining-handoff-finishable-now.md` блок B; полный контракт —
 * `2026-06-11-mobile-cora-exec-manager.md` §Ф2, Б4).
 *
 * Инвариант №1: мобайл = тот же web-app, читает СУЩЕСТВУЮЩИЕ эндпоинты, десктоп
 * НЕ меняем. Источники (оба уже есть):
 *   - `GET /dashboard/director` → `DirectorDashboardDomain` (requiresAction,
 *     valueStrip, strategicAlignment/goalsPulse, kpiCommitmentReliability,
 *     signalCounters, isEmpty);
 *   - `GET /dashboard/operations/overview` → `OperationsOverviewDomain`
 *     (teamTemperature, blockersCount).
 *
 * Раскладка (один столбец, glance): строка «Требует тебя: N» → 4 зоны
 * (Команда/Дела/Главная цель/Что мешает) → полоса «Кора за неделю» (valueStrip)
 * → кнопка «Спросить». Cold-start (Р6) при пустом графе замещает плитки.
 * Финансы/себестоимость НЕ показываем.
 *
 * Чистая логика зон вынесена в `overview-zones.ts` (тестируется юнитом).
 */

import Link from 'next/link';
import useSWR from 'swr';
import { AlertCircle, MessageCircle, Sparkles } from 'lucide-react';

import { dashboardApi } from '@/api/dashboard.api';
import { operationsDashboardApi } from '@/api/operations-dashboard.api';
import { humanizeApiError } from '@/api/api-error';
import { useAuth } from '@/contexts/auth-context';
import { directorDashboardFromApi } from '@/domain/director-dashboard';
import { fromOperationsOverviewApi } from '@/domain/operations-dashboard';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { ZoneTile } from '@/ui/mobile/shared/ZoneTile';
import { GlanceGauge } from '@/ui/mobile/shared/GlanceGauge';
import {
  isOverviewColdStart,
  overviewZonesFromDomain,
  requiresYouCount,
} from './overview-zones';

export function MobileOverviewClient() {
  const { currentOrgId } = useAuth();

  // Зеркало десктопного фетча: тот же эндпоинт `/dashboard/director?period=week`
  // через тот же маппер. Десктоп грузит тем же путём (без SWR), здесь SWR —
  // рендерится РОВНО ОДНО дерево (MobileShell), двойного fetch на экране нет.
  const directorSwr = useSWR(
    currentOrgId ? ['mobile-overview-director', currentOrgId, 'week'] : null,
    async () => {
      const res = await dashboardApi.getDirectorView(currentOrgId!, 'week');
      return directorDashboardFromApi(res);
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  // Операционка — тот же контракт, что у десктопной COO-панели.
  const operationsSwr = useSWR(
    currentOrgId ? ['operations-overview', currentOrgId] : null,
    async () => {
      const res = await operationsDashboardApi.getOverview();
      return fromOperationsOverviewApi(res);
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const director = directorSwr.data ?? null;
  const operations = operationsSwr.data ?? null;

  // Loading: ждём директорский (первичный источник раскладки).
  const loading = !!currentOrgId && directorSwr.isLoading && !director;
  const error = directorSwr.error
    ? humanizeApiError(directorSwr.error, 'Не удалось загрузить обзор')
    : null;

  const requiresYou = requiresYouCount(director);
  const coldStart = isOverviewColdStart(director);
  const zones = overviewZonesFromDomain(director, operations);
  const valueStrip = director?.valueStrip ?? null;

  return (
    <div className="mx-auto w-full max-w-md px-4 py-5">
      <h1 className="mb-1 text-xl font-semibold text-fg-primary">Обзор</h1>
      <p className="mb-4 text-sm text-fg-secondary">Главное за неделю — одним взглядом.</p>

      {loading && <OverviewSkeleton />}

      {!loading && error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-chip-danger-bg p-3 text-sm text-chip-danger-fg">
          <AlertCircle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && coldStart && (
        <div
          data-testid="overview-coldstart"
          className="mb-4 rounded-2xl border border-border-subtle bg-bg-card p-5 text-center"
        >
          <Sparkles size={24} className="mx-auto mb-2 text-accent" aria-hidden />
          <p className="text-base font-medium text-fg-primary">Граф ещё наполняется</p>
          <p className="mt-1 text-sm text-fg-secondary">
            Добавьте встречи и чаты — и Обзор оживёт.
          </p>
        </div>
      )}

      {!loading && !error && !coldStart && (
        <>
          {/* Строка «Требует тебя: N» — только при N>0 (gotcha: total=0 → нет). */}
          {requiresYou > 0 && (
            <Link
              href="/me/notifications"
              className="mb-3 flex items-center justify-between gap-2 rounded-xl bg-chip-warning-bg px-4 py-3 text-sm font-medium text-chip-warning-fg"
            >
              <span>Требует тебя</span>
              <span className="tabular-nums">{requiresYou}</span>
            </Link>
          )}

          {/* 4 зоны (Команда/Дела/Главная цель/Что мешает). */}
          <div className="grid grid-cols-2 gap-3">
            {zones.map((zone) =>
              zone.key === 'goal' ? (
                <ZoneTile
                  key={zone.key}
                  title={zone.title}
                  tone={zone.tone}
                  href={zone.href}
                  caption={zone.caption}
                  value={
                    <GlanceGauge percent={zone.gaugePercent ?? null} />
                  }
                />
              ) : (
                <ZoneTile
                  key={zone.key}
                  title={zone.title}
                  value={zone.value}
                  caption={zone.caption}
                  tone={zone.tone}
                  href={zone.href}
                />
              ),
            )}
          </div>

          {/* Полоса «Кора за неделю» (valueStrip) — компактная строка чисел. */}
          {valueStrip && (
            <div className="mt-4 rounded-2xl border border-border-subtle bg-bg-card p-4">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-secondary">
                Кора за неделю
              </div>
              <div className="grid grid-cols-3 gap-y-3 gap-x-2">
                <ValueStat n={valueStrip.meetingsProtocoled} label="встреч" />
                <ValueStat n={valueStrip.tasksExtracted} label="задач" />
                <ValueStat n={valueStrip.decisionsExtracted} label="решений" />
                <ValueStat n={valueStrip.questionsAnsweredByMemory} label="ответов" />
                <ValueStat n={valueStrip.commitmentsKept} label="обещаний" />
              </div>
            </div>
          )}
        </>
      )}

      {/* Кнопка «Спросить» — переход на AI-чат. Доступна всегда. */}
      <Link
        href="/chat"
        className="mt-5 flex items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-3 text-sm font-medium text-accent-fg active:opacity-90"
      >
        <MessageCircle size={18} aria-hidden />
        Спросить Кору
      </Link>
    </div>
  );
}

function ValueStat({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-lg font-semibold tabular-nums text-fg-primary">{n}</span>
      <span className="text-xs text-fg-tertiary">{label}</span>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-12 w-full rounded-xl" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
      <Skeleton className="h-20 w-full rounded-2xl" />
    </div>
  );
}
