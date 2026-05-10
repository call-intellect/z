'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Search, Snowflake, Trash2, Wallet } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { adminOrgsApi } from '@/api/admin-orgs.api';
import {
  ORG_TIER_LABELS,
  adminOrgListFromApi,
  type AdminOrgRowDomain,
  type OrgTier,
} from '@/domain/admin-org';
import {
  ADMIN_PERIOD_LABELS,
  formatUsd,
  type AdminPeriod,
} from '@/domain/admin-usage';
import { useToast } from '@/contexts/toast-context';
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
} from '../AdminStateViews';
import { useAdminQuery } from '../useAdminQuery';

const PERIODS: AdminPeriod[] = ['day', 'week', 'month'];
const TIERS: OrgTier[] = ['basic', 'pro', 'enterprise'];

export function OrgsClient() {
  const [period, setPeriod] = useState<AdminPeriod>('month');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [includeDeleted, setIncludeDeleted] = useState(false);

  const q = useAdminQuery(
    `admin-orgs:${period}:${search}:${includeDeleted}`,
    async () => {
      const res = await adminOrgsApi.list({
        period,
        ...(search ? { search } : {}),
        includeDeleted,
        limit: 200,
      });
      return adminOrgListFromApi(res);
    },
    [period, search, includeDeleted],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Организации</h1>
          <p className="text-sm text-fg-tertiary">
            Все Org: тариф, владелец, экономика, действия (заморозка/удаление).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          <label className="flex items-center gap-2 text-xs">
            <Switch
              checked={includeDeleted}
              onCheckedChange={(v) => setIncludeDeleted(v)}
            />
            С замороженными
          </label>
        </div>
      </div>

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
          <OrgsTable items={q.data.items} onChanged={q.refetch} />
        ))}
    </div>
  );
}

function OrgsTable({
  items,
  onChanged,
}: {
  items: AdminOrgRowDomain[];
  onChanged: () => void;
}) {
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
            <th className="px-3 py-2 text-left">Действия</th>
          </tr>
        </thead>
        <tbody>
          {items.map((o) => (
            <OrgRow key={o.id} org={o} onChanged={onChanged} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrgRow({
  org,
  onChanged,
}: {
  org: AdminOrgRowDomain;
  onChanged: () => void;
}) {
  const { addToast } = useToast();
  const [busy, setBusy] = useState(false);

  const updateTier = async (tier: OrgTier) => {
    setBusy(true);
    try {
      await adminOrgsApi.update(org.id, { tier });
      addToast({ type: 'success', message: 'Тариф обновлён' });
      onChanged();
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiError ? e.message : 'Не удалось обновить',
      });
    } finally {
      setBusy(false);
    }
  };

  const toggleFreeze = async () => {
    if (
      !window.confirm(
        org.isFrozen
          ? 'Разморозить Org? Доступ участников будет возвращён.'
          : 'Заморозить Org? Участники потеряют доступ до разморозки.',
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await adminOrgsApi.update(org.id, { freeze: !org.isFrozen });
      addToast({
        type: 'success',
        message: org.isFrozen ? 'Org разморожена' : 'Org заморожена',
      });
      onChanged();
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiError ? e.message : 'Не удалось',
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (
      !window.confirm(
        `Удалить Org «${org.name}»? Soft-delete: данные не уничтожаются, но Org становится недоступной.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await adminOrgsApi.remove(org.id);
      addToast({ type: 'success', message: 'Org удалена' });
      onChanged();
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiError ? e.message : 'Не удалось удалить',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr className="border-t border-border-subtle hover:bg-bg-overlay">
      <td className="px-3 py-2">
        <div className="font-medium">{org.name}</div>
        <div className="text-[10px] text-fg-tertiary">{org.slug}</div>
        {org.isFrozen && (
          <Badge variant="danger" className="mt-1 text-[10px]">
            заморожена
          </Badge>
        )}
      </td>
      <td className="px-3 py-2">
        <Select
          value={org.tier}
          onValueChange={(v) => void updateTier(v as OrgTier)}
          disabled={busy}
        >
          <SelectTrigger className="h-8 w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIERS.map((t) => (
              <SelectItem key={t} value={t}>
                {ORG_TIER_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="px-3 py-2 text-xs text-fg-tertiary">{org.ownerEmail ?? '—'}</td>
      <td className="px-3 py-2 text-right tabular-nums">{org.membersCount}</td>
      <td className="px-3 py-2 text-right tabular-nums">{org.meetingsCount}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {formatUsd(org.costUsdInPeriod)}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1">
          <Button
            asChild
            variant="ghost"
            size="sm"
            title="Тариф и лимиты (Phase 12)"
          >
            <Link href={`/admin/orgs/${encodeURIComponent(org.id)}/billing`}>
              <Wallet size={14} />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void toggleFreeze()}
            disabled={busy}
            title={org.isFrozen ? 'Разморозить' : 'Заморозить'}
          >
            <Snowflake size={14} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void remove()}
            disabled={busy}
            className="text-danger hover:bg-danger/10"
            title="Удалить"
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </td>
    </tr>
  );
}
