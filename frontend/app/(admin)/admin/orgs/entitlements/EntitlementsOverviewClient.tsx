'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Edit3, Search } from 'lucide-react';

import { adminEntitlementsApi } from '@/api/admin-entitlements.api';
import {
  entitlementOverviewFromApi,
  type EntitlementOverviewItemDomain,
} from '@/domain/admin-entitlement';
import { AdminSection } from '@/ui/components/admin/AdminSection';
import { AdminTabs, type AdminTabDef } from '@/ui/components/admin/AdminTabs';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
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
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  // После collapse-to-standard (ТЗ 2026-05-31) тариф один — фильтр по plan
  // больше не нужен.
  const entQ = useAdminQuery(
    `admin-entitlements:overview:${hasOverrides}`,
    async () => {
      const res = await adminEntitlementsApi.listOverview({
        hasOverrides,
        limit: 200,
      });
      return entitlementOverviewFromApi(res);
    },
    [hasOverrides],
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

/**
 * После collapse-to-standard (ТЗ 2026-05-31) тариф у Z один — `tier_standard`,
 * pivot «по фичам тарифов» теряет смысл (фичи зашиты в TIER_CONFIG и
 * редактируются релизом). Состав фич смотрим на карточке тарифа.
 */
function ByFeatureTab() {
  return (
    <AdminEmpty
      title="Свёрнут в карточку тарифа"
      description="Тариф у Z один. Состав фич (features) и квот (quotas) показывается на /admin/orgs/plans вместе с ценой и параметрами пакета."
    />
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

