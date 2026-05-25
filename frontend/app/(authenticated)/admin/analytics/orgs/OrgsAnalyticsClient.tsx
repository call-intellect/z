'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ExternalLink, Search } from 'lucide-react';

import { adminOrgsApi } from '@/api/admin-orgs.api';
import {
  ORG_TIER_LABELS,
  adminOrgListFromApi,
  type AdminOrgRowDomain,
} from '@/domain/admin-org';
import {
  ADMIN_PERIOD_LABELS,
  formatUsd,
  type AdminPeriod,
} from '@/domain/admin-usage';
import { AdminSection } from '@/ui/components/admin/AdminSection';
import { AdminCsvDownloadButton } from '@/ui/components/admin/AdminCsvDownloadButton';
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

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../../AdminStateViews';
import { useAdminQuery } from '../../useAdminQuery';

const PERIODS: AdminPeriod[] = ['day', 'week', 'month'];

/**
 * Read-only представление списка Org для аналитики.
 *
 * Полная редактируемая версия (с заморозкой/удалением/изменением тарифа) живёт
 * на `/admin/orgs`. Здесь — только просмотр и быстрые ссылки на drill-down.
 */
export function OrgsAnalyticsClient() {
  const [period, setPeriod] = useState<AdminPeriod>('month');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  const q = useAdminQuery(
    `admin-analytics-orgs:${period}:${search}`,
    async () => {
      const res = await adminOrgsApi.list({
        period,
        ...(search ? { search } : {}),
        includeDeleted: false,
        limit: 200,
      });
      return adminOrgListFromApi(res);
    },
    [period, search],
  );

  const csvRows: Array<Record<string, unknown>> = (q.data?.items ?? []).map(
    (o) => ({
      name: o.name,
      slug: o.slug,
      tier: ORG_TIER_LABELS[o.tier],
      ownerEmail: o.ownerEmail ?? '',
      membersCount: o.membersCount,
      meetingsCount: o.meetingsCount,
      costUsd: o.costUsdInPeriod.toFixed(4),
    }),
  );

  return (
    <AdminSection
      title="Org и пользователи"
      description={
        'Read-only обзор организаций и их расхода LLM. Управление (заморозка, ' +
        'изменение тарифа, удаление) — в разделе «Тенанты → Список Org».'
      }
      actions={
        <>
          <Select
            value={period}
            onValueChange={(v) => setPeriod(v as AdminPeriod)}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => (
                <SelectItem key={p} value={p}>
                  {ADMIN_PERIOD_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <AdminCsvDownloadButton
            rows={csvRows}
            columns={[
              { key: 'name', label: 'Org' },
              { key: 'slug', label: 'Slug' },
              { key: 'tier', label: 'Тариф' },
              { key: 'ownerEmail', label: 'Владелец' },
              { key: 'membersCount', label: 'Участников' },
              { key: 'meetingsCount', label: 'Встреч' },
              { key: 'costUsd', label: 'Расход, USD' },
            ]}
            filename={`admin-orgs-${period}.csv`}
          />
        </>
      }
    >
      <div className="space-y-4">
        <form
          className="flex max-w-md items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput.trim());
          }}
        >
          <Input
            placeholder="имя или slug Org"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <Button type="submit" size="sm" variant="secondary">
            <Search size={14} /> Найти
          </Button>
        </form>

        {q.isLoading && <AdminLoading rows={6} />}
        {!q.isLoading && q.isForbidden && <AdminForbidden />}
        {!q.isLoading && q.error && (
          <AdminError message={q.error} onRetry={q.refetch} />
        )}
        {!q.isLoading &&
          q.data &&
          (q.data.items.length === 0 ? (
            <AdminEmpty
              title="Ничего не найдено"
              description="Попробуйте изменить параметры поиска."
            />
          ) : (
            <OrgsReadonlyTable items={q.data.items} />
          ))}
      </div>
    </AdminSection>
  );
}

function OrgsReadonlyTable({ items }: { items: AdminOrgRowDomain[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border-subtle">
      <table className="w-full text-sm">
        <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
          <tr>
            <th className="px-3 py-2 text-left">Org</th>
            <th className="px-3 py-2 text-left">Тариф</th>
            <th className="px-3 py-2 text-left">Owner</th>
            <th className="px-3 py-2 text-right">Members</th>
            <th className="px-3 py-2 text-right">Встреч</th>
            <th className="px-3 py-2 text-right">Расход</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((o) => (
            <tr
              key={o.id}
              className="border-t border-border-subtle hover:bg-bg-overlay"
            >
              <td className="px-3 py-2">
                <div className="font-medium">{o.name}</div>
                <div className="text-[10px] text-fg-tertiary">{o.slug}</div>
                {o.isFrozen && (
                  <Badge variant="danger" className="mt-1 text-[10px]">
                    заморожена
                  </Badge>
                )}
              </td>
              <td className="px-3 py-2 text-sm">
                <Badge variant="secondary" className="text-[11px]">
                  {ORG_TIER_LABELS[o.tier]}
                </Badge>
              </td>
              <td className="px-3 py-2 text-xs text-fg-tertiary">
                {o.ownerEmail ?? '—'}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {o.membersCount}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {o.meetingsCount}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatUsd(o.costUsdInPeriod)}
              </td>
              <td className="px-3 py-2 text-right">
                <Button asChild variant="ghost" size="sm">
                  <Link
                    href={`/admin/economics/orgs/${encodeURIComponent(o.id)}`}
                    title="Drill-down по Org"
                  >
                    <ExternalLink size={12} />
                  </Link>
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
