'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Edit3, Search } from 'lucide-react';

import { adminEntitlementsApi } from '@/api/admin-entitlements.api';
import { adminPlansApi } from '@/api/admin-plans.api';
import {
  entitlementOverviewFromApi,
  type EntitlementOverviewItemDomain,
} from '@/domain/admin-entitlement';
import {
  planListFromApi,
  type PlanItemDomain,
} from '@/domain/admin-plan';
import { AdminSection } from '@/ui/components/admin/AdminSection';
import { AdminTabs, type AdminTabDef } from '@/ui/components/admin/AdminTabs';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../../AdminStateViews';
import { useAdminQuery } from '../../useAdminQuery';

const TABS: AdminTabDef[] = [
  { value: 'by-org', label: 'По Org' },
  { value: 'by-feature', label: 'По фиче' },
  { value: 'expiring', label: 'Истекающие' },
];

/**
 * `/admin/orgs/entitlements` — глобальный обзор overrides (Z-Admin Фаза 4).
 *
 * 3 вкладки:
 *   - «По Org» — таблица OrgEntitlement с фильтрами `hasOverrides` / `plan` +
 *     локальный поиск по orgName. Drill-in → `/admin/orgs/[id]?tab=billing`.
 *   - «По фиче» — pivot: агрегируем Plan.features + override-keys из listOverview.
 *   - «Истекающие» — заглушка («ждёт Фазу 9», у Entitlement сейчас нет
 *     expirationDate).
 */
export function EntitlementsOverviewClient() {
  return (
    <AdminSection
      breadcrumbs={[
        { label: 'Z-Admin', href: '/admin' },
        { label: 'Тенанты' },
        { label: 'Entitlements' },
      ]}
      title="Entitlements (overrides)"
      description="Какие Org переопределяют значения тарифов. Источник: OrgEntitlement.featureOverrides / quotaOverrides."
    >
      <AdminTabs tabs={TABS}>
        {(active) => (
          <>
            {active === 'by-org' && <ByOrgTab />}
            {active === 'by-feature' && <ByFeatureTab />}
            {active === 'expiring' && <ExpiringTab />}
          </>
        )}
      </AdminTabs>
    </AdminSection>
  );
}

// ───────────────────────────── По Org ────────────────────────────────────────

function ByOrgTab() {
  const [hasOverrides, setHasOverrides] = useState(true);
  const [planFilter, setPlanFilter] = useState<string>('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  const plansQ = useAdminQuery('admin-entitlements:plans', async () => {
    const res = await adminPlansApi.list();
    return planListFromApi(res);
  });

  const entQ = useAdminQuery(
    `admin-entitlements:overview:${hasOverrides}:${planFilter}`,
    async () => {
      const res = await adminEntitlementsApi.listOverview({
        hasOverrides,
        ...(planFilter ? { plan: planFilter } : {}),
        limit: 200,
      });
      return entitlementOverviewFromApi(res);
    },
    [hasOverrides, planFilter],
  );

  const filtered = useMemo(() => {
    if (!entQ.data) return [];
    const needle = search.trim().toLowerCase();
    if (!needle) return entQ.data.items;
    return entQ.data.items.filter(
      (it) =>
        it.orgName.toLowerCase().includes(needle) ||
        it.orgSlug.toLowerCase().includes(needle) ||
        it.tenantId.toLowerCase().includes(needle),
    );
  }, [entQ.data, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs">
          <Switch
            checked={hasOverrides}
            onCheckedChange={(v) => setHasOverrides(v)}
          />
          Только с override
        </label>
        <Select
          value={planFilter || 'all'}
          onValueChange={(v) => setPlanFilter(v === 'all' ? '' : v)}
        >
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Все тарифы" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все тарифы</SelectItem>
            {plansQ.data?.items.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.displayName} ({p.id})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput.trim());
          }}
        >
          <Input
            placeholder="имя или slug Org"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-[240px]"
          />
          <Button type="submit" size="sm" variant="secondary">
            <Search size={14} /> Найти
          </Button>
        </form>
      </div>

      {entQ.isLoading && <AdminLoading rows={5} />}
      {!entQ.isLoading && entQ.isForbidden && <AdminForbidden />}
      {!entQ.isLoading && entQ.error && (
        <AdminError message={entQ.error} onRetry={entQ.refetch} />
      )}
      {!entQ.isLoading && entQ.data && filtered.length === 0 && (
        <AdminEmpty
          title="Ничего не найдено"
          description="Попробуйте сменить фильтр «Только с override» или плана."
        />
      )}
      {!entQ.isLoading && filtered.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border-subtle">
          <table className="w-full text-sm">
            <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
              <tr>
                <th className="px-3 py-2 text-left">Org</th>
                <th className="px-3 py-2 text-left">Тариф</th>
                <th className="px-3 py-2 text-right">Override фич</th>
                <th className="px-3 py-2 text-right">Override лимитов</th>
                <th className="px-3 py-2 text-left">Заметка</th>
                <th className="px-3 py-2 text-left">Обновлено</th>
                <th className="px-3 py-2 text-left">Действия</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <EntRow key={row.tenantId} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EntRow({ row }: { row: EntitlementOverviewItemDomain }) {
  return (
    <tr className="border-t border-border-subtle align-top hover:bg-bg-overlay">
      <td className="px-3 py-2">
        <div className="font-medium">{row.orgName}</div>
        <div className="text-[11px] text-fg-tertiary">{row.orgSlug}</div>
      </td>
      <td className="px-3 py-2">
        <Badge variant="default" className="text-[10px]">
          {row.tier}
        </Badge>
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {row.featureOverridesKeys}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {row.quotaOverridesKeys}
      </td>
      <td className="px-3 py-2 max-w-[280px] text-xs text-fg-tertiary">
        {row.notes ?? '—'}
      </td>
      <td className="px-3 py-2 text-xs text-fg-tertiary">
        {row.updatedAt.toLocaleString('ru-RU')}
      </td>
      <td className="px-3 py-2">
        <Button asChild variant="ghost" size="sm" title="Редактировать">
          <Link
            href={`/admin/orgs/${encodeURIComponent(row.tenantId)}?tab=billing`}
          >
            <Edit3 size={14} />
          </Link>
        </Button>
      </td>
    </tr>
  );
}

// ──────────────────────────── По фиче ───────────────────────────────────────

type FeaturePivotRow = {
  key: string;
  /** Сколько Plan содержат этот ключ. */
  inPlans: number;
  /** Сколько Org override'ят этот ключ (приближённо: всем Org с overrides>0). */
  orgsWithOverridesApprox: number;
  /** Список планов, где встречается. */
  planIds: string[];
};

function ByFeatureTab() {
  const plansQ = useAdminQuery('admin-entitlements:plans-feat', async () => {
    const res = await adminPlansApi.list();
    return planListFromApi(res);
  });

  const entQ = useAdminQuery('admin-entitlements:overview-all', async () => {
    const res = await adminEntitlementsApi.listOverview({
      hasOverrides: true,
      limit: 200,
    });
    return entitlementOverviewFromApi(res);
  });

  const rows = useMemo<FeaturePivotRow[]>(() => {
    if (!plansQ.data) return [];
    // Соберём список всех feature-ключей по Plan.
    const map = new Map<string, { inPlans: number; planIds: string[] }>();
    for (const plan of plansQ.data.items) {
      for (const key of Object.keys(plan.features)) {
        const existing = map.get(key);
        if (existing) {
          existing.inPlans += 1;
          existing.planIds.push(plan.id);
        } else {
          map.set(key, { inPlans: 1, planIds: [plan.id] });
        }
      }
    }
    // listOverview не отдаёт сами ключи — отдаёт лишь counts. Поэтому
    // «orgsWithOverridesApprox» — это сумма Org, у которых хотя бы один
    // featureOverride; точное «сколько именно по этому ключу» требует
    // отдельного агрегата на бэке (Фаза 9).
    const orgsWithFeatureOverrides = entQ.data
      ? entQ.data.items.filter((it) => it.featureOverridesKeys > 0).length
      : 0;

    const result: FeaturePivotRow[] = [];
    for (const [key, info] of map) {
      result.push({
        key,
        inPlans: info.inPlans,
        planIds: info.planIds,
        orgsWithOverridesApprox: orgsWithFeatureOverrides,
      });
    }
    result.sort((a, b) => a.key.localeCompare(b.key));
    return result;
  }, [plansQ.data, entQ.data]);

  const isLoading = plansQ.isLoading || entQ.isLoading;
  const isForbidden = plansQ.isForbidden || entQ.isForbidden;
  const errorMsg = plansQ.error ?? entQ.error;

  if (isLoading) return <AdminLoading rows={5} />;
  if (isForbidden) return <AdminForbidden />;
  if (errorMsg) {
    return (
      <AdminError
        message={errorMsg}
        onRetry={() => {
          plansQ.refetch();
          entQ.refetch();
        }}
      />
    );
  }
  if (rows.length === 0) {
    return (
      <AdminEmpty
        title="Нет ни одной фичи в планах"
        description="Добавьте features в Plan через раздел «Тарифы»."
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-fg-tertiary">
        Pivot по всем feature-ключам, упомянутым в Plan.features. Колонка
        «Org с override» — приблизительная: считает Org, где есть хотя бы один
        override-ключ (точная разбивка по ключам появится в Фазе 9).
      </p>
      <div className="overflow-x-auto rounded-lg border border-border-subtle">
        <table className="w-full text-sm">
          <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
            <tr>
              <th className="px-3 py-2 text-left">Фича</th>
              <th className="px-3 py-2 text-right">В тарифах</th>
              <th className="px-3 py-2 text-left">Список тарифов</th>
              <th className="px-3 py-2 text-right">Org с override (≈)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                className="border-t border-border-subtle hover:bg-bg-overlay"
              >
                <td className="px-3 py-2 font-mono text-xs">{row.key}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.inPlans}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {row.planIds.map((id) => (
                      <Badge
                        key={id}
                        variant="default"
                        className="text-[10px]"
                      >
                        {id}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.orgsWithOverridesApprox}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────── Истекающие ─────────────────────────────────────

function ExpiringTab() {
  return (
    <AdminEmpty
      title="Подключено в Фазе 9"
      description="У OrgEntitlement пока нет expirationDate. Когда в Фазе 9 появится TTL — здесь будут истекающие override'ы и автопродление."
    />
  );
}

