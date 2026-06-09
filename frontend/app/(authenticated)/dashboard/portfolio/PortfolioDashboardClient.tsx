'use client';

import { Gauge, ListChecks, PieChart, Target } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import useSWR, { useSWRConfig } from 'swr';

import { ApiError } from '@/api/api-error';
import { goalsApi } from '@/api/goals.api';
import { portfolioHealthApi } from '@/api/portfolio-health.api';
import { useAuth } from '@/contexts/auth-context';
import {
  PORTFOLIO_PRIORITY_LABELS,
  PORTFOLIO_PRIORITY_SELECTABLE,
  deltaVsPrevWeekLabel,
  portfolioHealthFromApi,
  progressStatusPillTone,
  sortRowsByPriority,
  type PortfolioHealthDomain,
  type PortfolioHealthRowDomain,
} from '@/domain/portfolio-health';
import {
  CardTitle,
  CHART,
  DonutCard,
  GaugeCard,
  GlassCard,
  GRAD,
  ModernTable,
  MODERN_PAGE_BG,
  StatusPill,
  type ModernTableColumn,
} from '@/ui/components/dashboard/modern';

/**
 * ТЗ-2 Ф6.A — клиентский дашборд «Здоровье портфеля целей».
 *
 * Источник: `GET /api/v1/dashboard/operations/portfolio-health`.
 *   - Hero: GaugeCard «Здоровье портфеля» + светофор уровня + дельта к прошлой
 *     неделе.
 *   - DonutCard «Статусы целей» (5 сегментов).
 *   - Карточки агрегата по MoSCoW-приоритету («Must: N% выполнено»).
 *   - Таблица целей (имя · статус · приоритет · источник). owner/admin меняют
 *     приоритет inline (`goalsApi.setPriority` + optimistic SWR mutate).
 *
 * Современный визуальный язык (стекло/градиент/recharts), тёмная тема.
 */
export function PortfolioDashboardClient() {
  const { currentOrgId, currentOrgRole, isSuperAdmin } = useAuth();

  const swrKey = currentOrgId ? ['portfolio-health', currentOrgId] : null;
  const { data, error, isLoading } = useSWR(
    swrKey,
    () => portfolioHealthApi.get(currentOrgId!),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const domain: PortfolioHealthDomain | null = data
    ? portfolioHealthFromApi(data)
    : null;

  // Право редактировать MoSCoW: owner/admin своей Org или super_admin.
  const canEdit =
    isSuperAdmin || currentOrgRole === 'owner' || currentOrgRole === 'admin';

  const friendlyError = (() => {
    if (!error) return null;
    if (error instanceof ApiError && error.code === 'forbidden') {
      return 'Нет доступа к портфелю целей (нужна роль coo / admin / owner).';
    }
    return error instanceof Error ? error.message : 'Не удалось загрузить портфель.';
  })();

  return (
    <div style={{ background: MODERN_PAGE_BG, minHeight: '100vh' }}>
      <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6 md:py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: CHART.text }}>
            Портфель целей
          </h1>
          <p className="mt-1 text-sm" style={{ color: CHART.dim }}>
            Здоровье портфеля, приоритеты по MoSCoW и движение каждой цели.
          </p>
        </header>

        {isLoading && (
          <p className="text-sm" style={{ color: CHART.dim }}>
            Загрузка портфеля…
          </p>
        )}

        {friendlyError && (
          <GlassCard>
            <p className="text-sm" style={{ color: CHART.red }}>
              {friendlyError}
            </p>
          </GlassCard>
        )}

        {!isLoading && !friendlyError && domain && domain.isEmpty && (
          <GlassCard>
            <p className="text-sm" style={{ color: CHART.dim }}>
              Создайте цели — и портфель покажет здоровье.
            </p>
          </GlassCard>
        )}

        {!isLoading && !friendlyError && domain && !domain.isEmpty && (
          <PortfolioBody
            domain={domain}
            canEdit={canEdit}
            orgId={currentOrgId!}
            swrKey={swrKey!}
          />
        )}
      </div>
    </div>
  );
}

function PortfolioBody({
  domain,
  canEdit,
  orgId,
  swrKey,
}: {
  domain: PortfolioHealthDomain;
  canEdit: boolean;
  orgId: string;
  swrKey: readonly unknown[];
}) {
  const { mutate } = useSWRConfig();
  // ID целей, по которым приоритет сейчас сохраняется (disable селекта).
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  const sortedRows = sortRowsByPriority(domain.rows);

  async function handlePriorityChange(
    row: PortfolioHealthRowDomain,
    nextRaw: string,
  ) {
    const next =
      nextRaw === 'none'
        ? null
        : (nextRaw as 'must' | 'should' | 'could' | 'wont');

    setSaving((s) => ({ ...s, [row.goalId]: true }));
    try {
      await goalsApi.setPriority(orgId, row.goalId, next);
      // Перезагружаем агрегат: на бэке пересчитываются byPriority/achievedPercent.
      await mutate(swrKey);
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : 'Не удалось изменить приоритет.';
      toast.error(msg);
      // Откат: ревалидация вернёт серверное состояние.
      await mutate(swrKey);
    } finally {
      setSaving((s) => {
        const copy = { ...s };
        delete copy[row.goalId];
        return copy;
      });
    }
  }

  const columns: ModernTableColumn<PortfolioHealthRowDomain>[] = [
    {
      header: 'Цель',
      cell: (row) => (
        <span className="font-medium" style={{ color: CHART.text }}>
          {row.name}
        </span>
      ),
    },
    {
      header: 'Статус',
      cell: (row) => (
        <StatusPill status={progressStatusPillTone(row.progressStatus)} />
      ),
    },
    {
      header: 'Приоритет',
      cell: (row) =>
        canEdit ? (
          <select
            value={row.priority ?? 'none'}
            disabled={!!saving[row.goalId]}
            onChange={(e) => void handlePriorityChange(row, e.target.value)}
            className="rounded-lg px-2 py-1 text-xs outline-none"
            style={{
              background: 'oklch(1 0 0 / 0.06)',
              border: '1px solid oklch(1 0 0 / 0.1)',
              color: CHART.text,
            }}
            aria-label={`Приоритет цели «${row.name}»`}
          >
            <option value="none">{PORTFOLIO_PRIORITY_LABELS.none}</option>
            {PORTFOLIO_PRIORITY_SELECTABLE.map((p) => (
              <option key={p} value={p}>
                {PORTFOLIO_PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-xs" style={{ color: CHART.dim }}>
            {PORTFOLIO_PRIORITY_LABELS[row.priority ?? 'none']}
          </span>
        ),
    },
    {
      header: 'Причина',
      cell: (row) =>
        row.hasSource ? (
          <span className="text-xs" style={{ color: CHART.faint }}>
            есть источник
          </span>
        ) : (
          <span className="text-xs" style={{ color: CHART.faint }}>
            —
          </span>
        ),
    },
  ];

  const deltaText = deltaVsPrevWeekLabel(domain.deltaVsPrevWeek);

  return (
    <div className="space-y-6">
      {/* Hero: спидометр + светофор + дельта; пончик статусов рядом. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <GlassCard className="flex flex-col gap-4 p-6">
          <GaugeCard
            title="Здоровье портфеля"
            icon={<Gauge size={16} />}
            grad={GRAD.violet}
            value={domain.healthScore}
            max={100}
          />
          <div className="flex items-center justify-between">
            <span
              className="rounded-full px-3 py-1 text-xs font-medium"
              style={{
                color: domain.levelView.color,
                background: 'oklch(1 0 0 / 0.06)',
              }}
            >
              {domain.levelView.label}
            </span>
            <span className="text-xs" style={{ color: CHART.dim }}>
              {deltaText}
            </span>
          </div>
        </GlassCard>

        <DonutCard
          title="Статусы целей"
          icon={<PieChart size={16} />}
          grad={GRAD.teal}
          data={domain.statusSegments}
          centerValue={String(domain.rows.length)}
          centerLabel="целей"
        />
      </div>

      {/* Агрегат по MoSCoW-приоритету. */}
      {domain.priorityBuckets.length > 0 && (
        <GlassCard>
          <CardTitle icon={<Target size={16} />} grad={GRAD.amber}>
            Приоритеты (MoSCoW)
          </CardTitle>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {domain.priorityBuckets.map((b) => (
              <div
                key={b.priority}
                className="rounded-xl p-4"
                style={{ background: 'oklch(1 0 0 / 0.04)' }}
              >
                <div className="text-xs" style={{ color: CHART.dim }}>
                  {b.label}
                </div>
                <div
                  className="mt-1 text-2xl font-semibold leading-none"
                  style={{ color: CHART.text }}
                >
                  {b.achievedPercent}%
                </div>
                <div className="mt-1 text-[11px]" style={{ color: CHART.faint }}>
                  выполнено · {b.achievedCount} из {b.count}
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {/* Таблица целей с inline-приоритетом (owner/admin). */}
      <ModernTable<PortfolioHealthRowDomain>
        title="Цели"
        titleIcon={<ListChecks size={16} />}
        titleGrad={GRAD.blue}
        columns={columns}
        rows={sortedRows}
        getKey={(row) => row.goalId}
      />
    </div>
  );
}
