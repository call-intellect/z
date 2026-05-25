'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Building2,
  ClipboardList,
  FolderTree,
  ShieldAlert,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/api/api-error';
import { adminOrgsApi } from '@/api/admin-orgs.api';
import { AdminSection } from '@/ui/components/admin/AdminSection';
import { AdminTabs, type AdminTabDef } from '@/ui/components/admin/AdminTabs';
import {
  AdminDangerZone,
  DangerAction,
} from '@/ui/components/admin/AdminDangerZone';
import { AdminCsvDownloadButton } from '@/ui/components/admin/AdminCsvDownloadButton';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../../AdminStateViews';
import { useAdminQuery } from '../../useAdminQuery';
import { BillingAdminClient } from './billing/BillingAdminClient';

type Props = { orgId: string };

const TABS: AdminTabDef[] = [
  { value: 'overview', label: 'Обзор', icon: Building2 },
  { value: 'billing', label: 'Тариф и лимиты', icon: Wallet },
  { value: 'members', label: 'Участники', icon: Users },
  { value: 'sources', label: 'Источники', icon: FolderTree },
  { value: 'economics', label: 'Экономика', icon: TrendingUp },
  { value: 'audit', label: 'Аудит', icon: ClipboardList },
  { value: 'danger', label: 'Опасная зона', icon: ShieldAlert },
];

/**
 * Глобальная карточка Org (Z-Admin Фаза 4 редизайна).
 *
 * Активная вкладка через `?tab=`. Каждый таб — отдельный запрос (lazy),
 * чтобы карточка открывалась быстро и не делала лишних запросов.
 */
export function OrgDetailClient({ orgId }: Props) {
  return (
    <AdminSection
      breadcrumbs={[
        { label: 'Z-Admin', href: '/admin' },
        { label: 'Организации', href: '/admin/orgs' },
        { label: orgId },
      ]}
      title="Карточка организации"
      description={`Глобальный обзор тенанта tenantId=${orgId}.`}
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/orgs">К списку</Link>
        </Button>
      }
    >
      <AdminTabs tabs={TABS}>
        {(active) => (
          <>
            {active === 'overview' && <OverviewTab orgId={orgId} />}
            {active === 'billing' && <BillingAdminClient tenantId={orgId} />}
            {active === 'members' && <MembersTab orgId={orgId} />}
            {active === 'sources' && <SourcesTab orgId={orgId} />}
            {active === 'economics' && <EconomicsTab orgId={orgId} />}
            {active === 'audit' && <AuditTab orgId={orgId} />}
            {active === 'danger' && <DangerTab orgId={orgId} />}
          </>
        )}
      </AdminTabs>
    </AdminSection>
  );
}

// ───────────────────────────── Обзор ─────────────────────────────────────────

function OverviewTab({ orgId }: { orgId: string }) {
  const q = useAdminQuery(
    `org-overview:${orgId}`,
    () => adminOrgsApi.overview(orgId),
    [orgId],
  );

  if (q.isLoading) return <AdminLoading rows={4} />;
  if (q.isForbidden) return <AdminForbidden />;
  if (q.error) return <AdminError message={q.error} onRetry={q.refetch} />;
  if (!q.data) return <AdminEmpty title="Нет данных" description="Org не найдена." />;

  const ov = q.data;

  const tiles: Array<{ label: string; value: string; hint?: string }> = [
    { label: 'Название', value: ov.name, hint: ov.slug },
    {
      label: 'Тариф',
      value: ov.tier,
      hint: ov.isFrozen ? 'Org заморожена' : undefined,
    },
    {
      label: 'Создана',
      value: new Date(ov.createdAt).toLocaleDateString('ru-RU'),
    },
    { label: 'Владелец', value: ov.ownerEmail ?? '—' },
    { label: 'Участников', value: String(ov.membersCount) },
    { label: 'Встреч', value: String(ov.meetingsCount) },
    {
      label: 'Расход за 30 дней',
      value:
        ov.totalSpendUsd === 0
          ? '$0,00'
          : `$${ov.totalSpendUsd.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}`,
    },
    {
      label: 'Доход (план)',
      value:
        ov.totalRevenueRub === null
          ? '—'
          : `${ov.totalRevenueRub.toLocaleString('ru-RU')} ₽/мес`,
    },
  ];

  return (
    <div className="space-y-4">
      {ov.isFrozen && (
        <div className="rounded-md border border-warning/40 bg-warning/5 px-4 py-3 text-sm text-warning">
          Org заморожена. Участники не могут заходить, новые встречи недоступны.
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="rounded-lg border border-border-subtle bg-bg-card p-4"
          >
            <div className="text-[11px] uppercase tracking-wide text-fg-tertiary">
              {tile.label}
            </div>
            <div className="mt-1 text-lg font-medium tabular-nums">
              {tile.value}
            </div>
            {tile.hint && (
              <div className="mt-1 text-[11px] text-fg-tertiary">{tile.hint}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────── Участники ──────────────────────────────────────

type MemberRow = {
  userId: string;
  email: string;
  name: string;
  role: string;
  joinedAt: string;
  lastSeenAt: string;
};

function MembersTab({ orgId }: { orgId: string }) {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [accumulator, setAccumulator] = useState<MemberRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const q = useAdminQuery(
    `org-members:${orgId}:${cursor ?? ''}`,
    async () => {
      const res = await adminOrgsApi.members(orgId, {
        ...(cursor ? { cursor } : {}),
        limit: 50,
      });
      const newItems: MemberRow[] = res.items.map((m) => ({
        userId: m.userId,
        email: m.email ?? '',
        name: m.name,
        role: m.role,
        joinedAt: m.joinedAt,
        lastSeenAt: m.lastSeenAt ?? '',
      }));
      // Если это первая страница — заменяем; иначе — добавляем.
      setAccumulator((prev) => (cursor ? [...prev, ...newItems] : newItems));
      setNextCursor(res.nextCursor);
      return res;
    },
    [orgId, cursor],
  );

  if (q.isLoading && accumulator.length === 0) return <AdminLoading rows={5} />;
  if (q.isForbidden) return <AdminForbidden />;
  if (q.error) return <AdminError message={q.error} onRetry={q.refetch} />;
  if (accumulator.length === 0) {
    return (
      <AdminEmpty
        title="Нет участников"
        description="В этой Org пока нет ни одного membership-а."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2">
        <AdminCsvDownloadButton
          rows={accumulator}
          columns={[
            { key: 'email', label: 'Email' },
            { key: 'name', label: 'Имя' },
            { key: 'role', label: 'Роль' },
            {
              key: 'joinedAt',
              label: 'Вступил',
              format: (v) =>
                v ? new Date(String(v)).toLocaleString('ru-RU') : '',
            },
            {
              key: 'lastSeenAt',
              label: 'Последний визит',
              format: (v) =>
                v ? new Date(String(v)).toLocaleString('ru-RU') : '',
            },
          ]}
          filename={`org-${orgId}-members`}
        />
      </div>
      <div className="overflow-x-auto rounded-lg border border-border-subtle">
        <table className="w-full text-sm">
          <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
            <tr>
              <th className="px-3 py-2 text-left">Email</th>
              <th className="px-3 py-2 text-left">Имя</th>
              <th className="px-3 py-2 text-left">Роль</th>
              <th className="px-3 py-2 text-left">Вступил</th>
              <th className="px-3 py-2 text-left">Последний визит</th>
            </tr>
          </thead>
          <tbody>
            {accumulator.map((m) => (
              <tr
                key={m.userId}
                className="border-t border-border-subtle hover:bg-bg-overlay"
              >
                <td className="px-3 py-2">{m.email || '—'}</td>
                <td className="px-3 py-2">{m.name || '—'}</td>
                <td className="px-3 py-2">
                  <Badge variant="default" className="text-[10px]">
                    {m.role}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-xs text-fg-tertiary">
                  {m.joinedAt
                    ? new Date(m.joinedAt).toLocaleString('ru-RU')
                    : '—'}
                </td>
                <td className="px-3 py-2 text-xs text-fg-tertiary">
                  {m.lastSeenAt
                    ? new Date(m.lastSeenAt).toLocaleString('ru-RU')
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {nextCursor && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            disabled={q.isLoading}
            onClick={() => setCursor(nextCursor)}
          >
            {q.isLoading ? 'Загружаем…' : 'Показать ещё'}
          </Button>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────── Источники ──────────────────────────────────────

function SourcesTab({ orgId }: { orgId: string }) {
  const q = useAdminQuery(
    `org-sources:${orgId}`,
    () => adminOrgsApi.sources(orgId),
    [orgId],
  );

  if (q.isLoading) return <AdminLoading rows={4} />;
  if (q.isForbidden) return <AdminForbidden />;
  if (q.error) return <AdminError message={q.error} onRetry={q.refetch} />;
  if (!q.data || q.data.items.length === 0) {
    return (
      <AdminEmpty
        title="Нет источников"
        description="Org пока не подключила ни одного канала или вебхука."
      />
    );
  }

  const channels = q.data.items.filter((it) => it.kind === 'channel');
  const webhooks = q.data.items.filter((it) => it.kind === 'webhook_subscription');

  return (
    <div className="space-y-6">
      <SourcesGroup
        title="Каналы"
        description="Conversational-источники: Telegram-боты, email-inbox, MAX и пр."
        items={channels}
        emptyHint="Нет подключённых каналов."
      />
      <SourcesGroup
        title="Webhook-подписки"
        description="Внешние URL, на которые Z отправляет события."
        items={webhooks}
        emptyHint="Нет webhook-подписок."
      />
    </div>
  );
}

function SourcesGroup({
  title,
  description,
  items,
  emptyHint,
}: {
  title: string;
  description: string;
  items: Array<{ kind: string; type: string; id: string; status: string; createdAt: string }>;
  emptyHint: string;
}) {
  return (
    <section className="space-y-2 rounded-lg border border-border-subtle bg-bg-card p-4">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-fg-tertiary">{description}</p>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-fg-tertiary">{emptyHint}</p>
      ) : (
        <div className="overflow-hidden rounded-md border border-border-subtle">
          <table className="w-full text-sm">
            <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
              <tr>
                <th className="px-3 py-2 text-left">Тип</th>
                <th className="px-3 py-2 text-left">ID</th>
                <th className="px-3 py-2 text-left">Статус</th>
                <th className="px-3 py-2 text-left">Создан</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr
                  key={`${it.kind}-${it.id}`}
                  className="border-t border-border-subtle"
                >
                  <td className="px-3 py-2">{it.type}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-fg-tertiary">
                    {it.id}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="default" className="text-[10px]">
                      {it.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-fg-tertiary">
                    {new Date(it.createdAt).toLocaleString('ru-RU')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ──────────────────────────── Экономика ──────────────────────────────────────

function EconomicsTab({ orgId }: { orgId: string }) {
  const q = useAdminQuery(
    `org-overview-econ:${orgId}`,
    () => adminOrgsApi.overview(orgId),
    [orgId],
  );

  if (q.isLoading) return <AdminLoading rows={2} />;
  if (q.isForbidden) return <AdminForbidden />;
  if (q.error) return <AdminError message={q.error} onRetry={q.refetch} />;
  if (!q.data) return <AdminEmpty title="Нет данных" description="" />;

  const ov = q.data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border-subtle bg-bg-card p-4">
          <div className="text-[11px] uppercase tracking-wide text-fg-tertiary">
            Расход за 30 дней
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            $
            {ov.totalSpendUsd.toLocaleString('ru-RU', {
              maximumFractionDigits: 2,
            })}
          </div>
          <p className="mt-2 text-[11px] text-fg-tertiary">
            Сумма по AiUsageLog за последние 30 календарных дней.
          </p>
        </div>
        <div className="rounded-lg border border-border-subtle bg-bg-card p-4">
          <div className="text-[11px] uppercase tracking-wide text-fg-tertiary">
            Доход по тарифу
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {ov.totalRevenueRub === null
              ? '—'
              : `${ov.totalRevenueRub.toLocaleString('ru-RU')} ₽/мес`}
          </div>
          <p className="mt-2 text-[11px] text-fg-tertiary">
            Цена текущего Plan (если задана). Для full-картины откройте полный
            отчёт.
          </p>
        </div>
      </div>
      <div className="flex justify-end">
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/analytics/economics">Полный отчёт экономики</Link>
        </Button>
      </div>
    </div>
  );
}

// ────────────────────────────── Аудит ───────────────────────────────────────

type AuditRow = {
  id: string;
  superAdminEmail: string;
  route: string;
  method: string;
  reason: string;
  createdAt: string;
};

function AuditTab({ orgId }: { orgId: string }) {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [accumulator, setAccumulator] = useState<AuditRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const q = useAdminQuery(
    `org-audit:${orgId}:${cursor ?? ''}`,
    async () => {
      const res = await adminOrgsApi.audit(orgId, {
        ...(cursor ? { cursor } : {}),
        limit: 50,
      });
      const newRows: AuditRow[] = res.items.map((r) => ({
        id: r.id,
        superAdminEmail: r.superAdminEmail ?? r.superAdminUserId,
        route: r.route,
        method: r.method,
        reason: r.reason ?? '',
        createdAt: r.createdAt,
      }));
      setAccumulator((prev) => (cursor ? [...prev, ...newRows] : newRows));
      setNextCursor(res.nextCursor);
      return res;
    },
    [orgId, cursor],
  );

  if (q.isLoading && accumulator.length === 0) return <AdminLoading rows={6} />;
  if (q.isForbidden) return <AdminForbidden />;
  if (q.error) return <AdminError message={q.error} onRetry={q.refetch} />;
  if (accumulator.length === 0) {
    return (
      <AdminEmpty
        title="Нет записей"
        description="Действий super_admin по этой Org ещё не было."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2">
        <AdminCsvDownloadButton
          rows={accumulator}
          columns={[
            {
              key: 'createdAt',
              label: 'Когда',
              format: (v) => new Date(String(v)).toLocaleString('ru-RU'),
            },
            { key: 'superAdminEmail', label: 'super_admin' },
            { key: 'method', label: 'Метод' },
            { key: 'route', label: 'Маршрут' },
            { key: 'reason', label: 'Причина' },
          ]}
          filename={`org-${orgId}-audit`}
        />
      </div>
      <div className="overflow-x-auto rounded-lg border border-border-subtle">
        <table className="w-full text-sm">
          <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
            <tr>
              <th className="px-3 py-2 text-left">Когда</th>
              <th className="px-3 py-2 text-left">super_admin</th>
              <th className="px-3 py-2 text-left">Метод</th>
              <th className="px-3 py-2 text-left">Маршрут</th>
              <th className="px-3 py-2 text-left">Причина</th>
            </tr>
          </thead>
          <tbody>
            {accumulator.map((r) => (
              <tr
                key={r.id}
                className="border-t border-border-subtle hover:bg-bg-overlay"
              >
                <td className="px-3 py-2 text-xs text-fg-tertiary">
                  {new Date(r.createdAt).toLocaleString('ru-RU')}
                </td>
                <td className="px-3 py-2">{r.superAdminEmail}</td>
                <td className="px-3 py-2">
                  <Badge variant="default" className="text-[10px]">
                    {r.method}
                  </Badge>
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-fg-tertiary">
                  {r.route}
                </td>
                <td className="px-3 py-2 text-xs text-fg-secondary">
                  {r.reason || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {nextCursor && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            disabled={q.isLoading}
            onClick={() => setCursor(nextCursor)}
          >
            {q.isLoading ? 'Загружаем…' : 'Показать ещё'}
          </Button>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────── Опасная зона ────────────────────────────────

function DangerTab({ orgId }: { orgId: string }) {
  const q = useAdminQuery(
    `org-danger:${orgId}`,
    () => adminOrgsApi.overview(orgId),
    [orgId],
  );

  if (q.isLoading) return <AdminLoading rows={3} />;
  if (q.isForbidden) return <AdminForbidden />;
  if (q.error) return <AdminError message={q.error} onRetry={q.refetch} />;
  if (!q.data) return <AdminEmpty title="Нет данных" description="" />;

  const isFrozen = q.data.isFrozen;

  const toggleFreeze = async () => {
    try {
      await adminOrgsApi.update(orgId, { freeze: !isFrozen });
      toast.success(isFrozen ? 'Org разморожена' : 'Org заморожена');
      q.refetch();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Не удалось изменить состояние',
      );
      throw e;
    }
  };

  const removeOrg = async () => {
    try {
      await adminOrgsApi.remove(orgId);
      toast.success('Org удалена (soft-delete)');
      q.refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось удалить');
      throw e;
    }
  };

  return (
    <AdminDangerZone
      title="Опасные действия"
      description="Эти операции затрагивают всех участников Org. Все действия записываются в журнал super_admin."
    >
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border-subtle bg-bg-card p-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {isFrozen ? 'Разморозить организацию' : 'Заморозить организацию'}
          </p>
          <p className="text-xs text-fg-tertiary">
            {isFrozen
              ? 'Доступ участников будет возвращён, все процессы возобновятся.'
              : 'Участники потеряют доступ. Запись данных останется в БД.'}
          </p>
        </div>
        <DangerAction
          label={isFrozen ? 'Разморозить' : 'Заморозить'}
          title={isFrozen ? 'Разморозить Org?' : 'Заморозить Org?'}
          description={
            isFrozen
              ? 'Org снова станет доступной для участников.'
              : 'Участники потеряют доступ до разморозки.'
          }
          severity="high"
          confirmLabel={isFrozen ? 'Разморозить' : 'Заморозить'}
          onConfirm={toggleFreeze}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border-subtle bg-bg-card p-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">Удалить организацию (soft-delete)</p>
          <p className="text-xs text-fg-tertiary">
            Org помечается удалённой. Данные не уничтожаются, но Org становится
            недоступной. Восстановление возможно через прямой UPDATE в БД.
          </p>
        </div>
        <DangerAction
          label="Удалить Org"
          title={`Удалить Org id=${orgId}?`}
          description="Soft-delete. Опишите причину — попадёт в журнал super_admin."
          severity="destructive"
          confirmLabel="Удалить"
          onConfirm={removeOrg}
        />
      </div>
    </AdminDangerZone>
  );
}
