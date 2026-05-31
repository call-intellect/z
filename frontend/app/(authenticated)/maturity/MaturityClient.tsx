'use client';

import { useCallback, useEffect, useState, type JSX } from 'react';
import Link from 'next/link';

import { ApiError } from '@/api/api-error';
import { maturityApi } from '@/api/maturity.api';
import { useAuth } from '@/contexts/auth-context';
import {
  toMaturityOverviewDomain,
  type MaturityOverviewDomain,
} from '@/domain/maturity';
import { Button } from '@/ui/shadcn/button';
import { Card } from '@/ui/shadcn/card';

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '@app/(admin)/admin/AdminStateViews';

/**
 * `/maturity` UI — overview виджеты + кнопка ручного пересчёта.
 */
export function MaturityClient(): JSX.Element {
  const { currentOrgId, currentOrgRole, isLoading: authLoading } = useAuth();
  if (authLoading) return <AdminLoading rows={4} />;
  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Вы не состоите ни в одной Org."
      />
    );
  }
  const canRebuild = currentOrgRole === 'owner' || currentOrgRole === 'admin';
  return <MaturityContent orgId={currentOrgId} canRebuild={canRebuild} />;
}

function MaturityContent({
  orgId,
  canRebuild,
}: {
  orgId: string;
  canRebuild: boolean;
}): JSX.Element {
  const [overview, setOverview] = useState<MaturityOverviewDomain | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await maturityApi.overview(orgId);
      setOverview(toMaturityOverviewDomain(r));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось загрузить сводку');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRebuild = useCallback(async () => {
    if (!canRebuild) return;
    setRebuilding(true);
    setError(null);
    try {
      await maturityApi.rebuild(orgId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось пересчитать');
    } finally {
      setRebuilding(false);
    }
  }, [canRebuild, orgId, load]);

  if (loading) return <AdminLoading rows={6} />;
  if (error && !overview) return <AdminError message={error} onRetry={() => void load()} />;
  if (!overview) return <AdminError message="Сводка недоступна" />;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-fg-primary">
            Зрелость компании
          </h1>
          <p className="mt-1 text-sm text-fg-tertiary">
            Агрегатный показатель: насколько полно описаны должности, отделы,
            процессы и реакция на probe-запросы. Связано со{' '}
            <Link href="/structure" className="underline">
              Структурой
            </Link>
            ,{' '}
            <Link href="/company" className="underline">
              Компанией
            </Link>
            ,{' '}
            <Link href="/domains" className="underline">
              Доменами
            </Link>
            .
          </p>
        </div>
        {canRebuild && (
          <Button
            variant="outline"
            onClick={() => void handleRebuild()}
            disabled={rebuilding}
          >
            {rebuilding ? 'Пересчитываем…' : 'Пересчитать'}
          </Button>
        )}
      </header>

      {error && <AdminError message={error} />}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <ScoreCard
          title="Зрелость компании"
          value={overview.companyPercent}
          hint={
            overview.lastCalcAt
              ? `пересчитано ${overview.lastCalcAt.toLocaleString('ru-RU')}`
              : 'ещё не пересчитывалось'
          }
        />
        <ScoreCard
          title="Средняя зрелость должностей"
          value={overview.averageRolePercent}
          hint={`${overview.rolesScored} из ${overview.rolesTotal} оценено`}
        />
        <ScoreCard
          title="Средняя зрелость отделов"
          value={overview.averageDepartmentPercent}
          hint={`${overview.departmentsScored} из ${overview.departmentsTotal} оценено`}
        />
      </div>

      <Card className="p-5">
        <h2 className="mb-3 text-sm font-medium text-fg-primary">
          Распределение должностей по зрелости
        </h2>
        <div className="space-y-2">
          {overview.distribution.map((b) => {
            const max = Math.max(
              1,
              ...overview.distribution.map((d) => d.count),
            );
            const width = Math.round((b.count / max) * 100);
            return (
              <div key={b.bucket} className="flex items-center gap-3 text-sm">
                <div className="w-20 text-fg-tertiary">{b.bucket}</div>
                <div className="relative h-3 flex-1 overflow-hidden rounded bg-bg-overlay">
                  <div
                    className="h-full bg-accent"
                    style={{ width: `${width}%` }}
                  />
                </div>
                <div className="w-10 text-right text-fg-secondary">{b.count}</div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-3">
        <Stat label="Доменов всего" value={overview.domainsTotal} />
        <Stat label="Доменов с оценкой" value={overview.domainsScored} />
        <Stat
          label="Покрытие отделов"
          value={
            overview.departmentsTotal
              ? `${overview.departmentsScored}/${overview.departmentsTotal}`
              : '0/0'
          }
        />
      </Card>
    </div>
  );
}

function ScoreCard({
  title,
  value,
  hint,
}: {
  title: string;
  value: number | null;
  hint?: string;
}): JSX.Element {
  return (
    <Card className="p-5">
      <div className="text-xs text-fg-tertiary">{title}</div>
      <div className="mt-2 text-3xl font-semibold text-accent">
        {value === null ? '—' : `${value}%`}
      </div>
      {hint && <div className="mt-1 text-[11px] text-fg-tertiary">{hint}</div>}
    </Card>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string | number;
}): JSX.Element {
  return (
    <div>
      <div className="text-xs text-fg-tertiary">{label}</div>
      <div className="mt-1 text-lg font-medium text-fg-primary">{value}</div>
    </div>
  );
}
