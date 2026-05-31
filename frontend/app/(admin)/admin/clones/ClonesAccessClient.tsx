'use client';

import { useState } from 'react';
import { Plus, Search } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { adminClonesApi, type CloneTypeApi } from '@/api/admin-clones.api';
import {
  accessGrantListFromApi,
  ACCESS_GRANT_STATUS_LABELS,
  CLONE_TYPE_LABELS,
  type AccessGrant,
  type AccessGrantStatus,
} from '@/domain/admin-clone-access-grant';
import { useAuth } from '@/contexts/auth-context';
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

import { CreateGrantDialog } from './CreateGrantDialog';
import { ExtendGrantDialog } from './ExtendGrantDialog';
import { RevokeGrantDialog } from './RevokeGrantDialog';

/**
 * Главный клиент раздела «Управление доступом к клонам».
 *
 * Поток:
 *   1. Фильтры (cloneType, поиск по имени получателя, «только активные»),
 *      pagination (server-side).
 *   2. Таблица грантов с действиями «Отозвать» / «Продлить».
 *   3. Модал «Выдать грант» (CRUD-create).
 *
 * Поиск по `grantedTo.userName` фильтруется на клиенте — backend такого
 * параметра не поддерживает, а pageSize ≤ 200, на витрину доступов этого
 * достаточно.
 *
 * Состояния:
 *   - loading → `AdminLoading`.
 *   - forbidden (403) → `AdminForbidden`.
 *   - error → `AdminError` с retry.
 *   - empty (Org без грантов) → `AdminEmpty` с подсказкой «нажмите Выдать».
 */
export function ClonesAccessClient() {
  const { currentOrgId, currentOrgRole, isLoading: authLoading } = useAuth();

  const [cloneType, setCloneType] = useState<'all' | CloneTypeApi>('all');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active'>('active');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const [createOpen, setCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<AccessGrant | null>(null);
  const [extendTarget, setExtendTarget] = useState<AccessGrant | null>(null);

  const key = `admin-clones-grants:${currentOrgId ?? '-'}:${cloneType}:${activeFilter}:${page}`;

  const q = useAdminQuery(
    key,
    async () => {
      if (!currentOrgId) return null;
      const res = await adminClonesApi.listAccessGrants(currentOrgId, {
        page,
        pageSize,
        ...(cloneType !== 'all' ? { cloneType } : {}),
        ...(activeFilter === 'active' ? { isActive: true } : {}),
      });
      return accessGrantListFromApi(res);
    },
    [currentOrgId, cloneType, activeFilter, page],
  );

  // UI-permission check: разрешён только владельцу/админу Org. super_admin
  // не имеет currentOrgRole, но всё равно сможет открыть страницу — backend
  // решит через OrgAdminGuard.
  const isAllowed =
    currentOrgRole === 'owner' || currentOrgRole === 'admin';

  if (!authLoading && !isAllowed) {
    return (
      <AdminForbidden
        title="Доступ ограничен"
        description="Раздел «Доступы к клонам» доступен только владельцу или администратору организации."
      />
    );
  }

  // Локальный фильтр по поиску (имя получателя или email).
  const searchLower = searchInput.trim().toLowerCase();
  const filteredItems = q.data
    ? q.data.items.filter((g) => {
        if (!searchLower) return true;
        const name = g.grantedTo.userName.toLowerCase();
        const email = (g.grantedTo.userEmail ?? '').toLowerCase();
        return name.includes(searchLower) || email.includes(searchLower);
      })
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Доступы к клонам</h1>
          <p className="text-sm text-fg-tertiary">
            Выдача и отзыв доступов сотрудников к ролевым клонам компании.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus size={14} /> Выдать грант
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-fg-tertiary">
            Тип клона
          </span>
          <Select
            value={cloneType}
            onValueChange={(v) => {
              setCloneType(v as 'all' | CloneTypeApi);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все</SelectItem>
              <SelectItem value="role">{CLONE_TYPE_LABELS.role}</SelectItem>
              <SelectItem value="person">
                {CLONE_TYPE_LABELS.person}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <form
          className="flex items-center gap-2"
          onSubmit={(e) => e.preventDefault()}
        >
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-fg-tertiary">
              Поиск получателя
            </span>
            <div className="relative">
              <Search
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-tertiary"
              />
              <Input
                className="w-[260px] pl-8"
                placeholder="Имя или email пользователя"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
          </div>
        </form>

        <label className="flex items-center gap-2 pb-[10px] text-xs">
          <Switch
            checked={activeFilter === 'active'}
            onCheckedChange={(v) => {
              setActiveFilter(v ? 'active' : 'all');
              setPage(1);
            }}
          />
          Только активные
        </label>
      </div>

      {q.isLoading && <AdminLoading rows={6} />}
      {!q.isLoading && q.isForbidden && (
        <AdminForbidden
          title="Доступ ограничен"
          description="Раздел доступен только владельцу или администратору организации."
        />
      )}
      {!q.isLoading && q.error && (
        <AdminError message={q.error} onRetry={q.refetch} />
      )}
      {!q.isLoading && q.data && (
        <>
          {q.data.items.length === 0 ? (
            <AdminEmpty
              title="Грантов пока нет"
              description="Никому не выдано доступов к клонам. Нажмите «Выдать грант», чтобы открыть доступ первому сотруднику."
            />
          ) : filteredItems.length === 0 ? (
            <AdminEmpty
              title="Ничего не найдено"
              description={`По запросу «${searchInput.trim()}» среди ${q.data.items.length} грантов совпадений нет.`}
            />
          ) : (
            <>
              <AccessGrantsTable
                items={filteredItems}
                onRevoke={(g) => setRevokeTarget(g)}
                onExtend={(g) => setExtendTarget(g)}
              />
              <PaginationBar
                page={q.data.page}
                pageSize={q.data.pageSize}
                total={q.data.total}
                onPageChange={setPage}
              />
            </>
          )}
        </>
      )}

      {createOpen && currentOrgId && (
        <CreateGrantDialog
          orgId={currentOrgId}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            q.refetch();
          }}
        />
      )}
      {revokeTarget && currentOrgId && (
        <RevokeGrantDialog
          orgId={currentOrgId}
          grant={revokeTarget}
          onClose={() => setRevokeTarget(null)}
          onRevoked={() => {
            setRevokeTarget(null);
            q.refetch();
          }}
        />
      )}
      {extendTarget && currentOrgId && (
        <ExtendGrantDialog
          orgId={currentOrgId}
          grant={extendTarget}
          onClose={() => setExtendTarget(null)}
          onUpdated={() => {
            setExtendTarget(null);
            q.refetch();
          }}
        />
      )}
    </div>
  );
}

// ─────────────── таблица ───────────────

function AccessGrantsTable({
  items,
  onRevoke,
  onExtend,
}: {
  items: AccessGrant[];
  onRevoke: (g: AccessGrant) => void;
  onExtend: (g: AccessGrant) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border-subtle">
      <table className="w-full text-sm">
        <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
          <tr>
            <th className="px-3 py-2 text-left">Клон</th>
            <th className="px-3 py-2 text-left">Тип</th>
            <th className="px-3 py-2 text-left">Получатель</th>
            <th className="px-3 py-2 text-left">Выдал</th>
            <th className="px-3 py-2 text-left">Когда</th>
            <th className="px-3 py-2 text-left">Статус</th>
            <th className="px-3 py-2 text-left">Истекает</th>
            <th className="px-3 py-2 text-left">Действия</th>
          </tr>
        </thead>
        <tbody>
          {items.map((g) => (
            <AccessGrantRow
              key={g.id}
              grant={g}
              onRevoke={onRevoke}
              onExtend={onExtend}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AccessGrantRow({
  grant,
  onRevoke,
  onExtend,
}: {
  grant: AccessGrant;
  onRevoke: (g: AccessGrant) => void;
  onExtend: (g: AccessGrant) => void;
}) {
  return (
    <tr className="border-t border-border-subtle align-top hover:bg-bg-overlay">
      <td className="px-3 py-2">
        <div className="font-medium text-fg-primary">{grant.cloneLabel}</div>
        <div className="font-mono text-[10px] text-fg-tertiary">
          {grant.cloneRefId}
        </div>
      </td>
      <td className="px-3 py-2 text-fg-secondary">
        {CLONE_TYPE_LABELS[grant.cloneType]}
      </td>
      <td className="px-3 py-2">
        <div className="font-medium">{grant.grantedTo.userName}</div>
        {grant.grantedTo.userEmail && (
          <div className="text-[11px] text-fg-tertiary">
            {grant.grantedTo.userEmail}
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-fg-secondary">
        {grant.grantedBy.userName}
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-xs text-fg-secondary">
        {grant.grantedAt.toLocaleString('ru-RU')}
      </td>
      <td className="px-3 py-2">
        <StatusBadge status={grant.status} />
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-xs text-fg-secondary">
        {grant.expiresAt
          ? grant.expiresAt.toLocaleString('ru-RU')
          : 'бессрочно'}
      </td>
      <td className="px-3 py-2">
        {grant.isActive ? (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onExtend(grant)}
              title="Продлить или снять срок"
            >
              Продлить
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onRevoke(grant)}
              className="text-danger hover:bg-danger/10"
              title="Отозвать доступ"
            >
              Отозвать
            </Button>
          </div>
        ) : (
          <span className="text-xs text-fg-tertiary">—</span>
        )}
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: AccessGrantStatus }) {
  const variant: 'success' | 'danger' | 'secondary' =
    status === 'active'
      ? 'success'
      : status === 'revoked'
        ? 'danger'
        : 'secondary';
  return (
    <Badge variant={variant} className="text-[10px]">
      {ACCESS_GRANT_STATUS_LABELS[status]}
    </Badge>
  );
}

// ─────────────── пагинация ───────────────

function PaginationBar({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (p: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) {
    return (
      <div className="text-xs text-fg-tertiary">
        Всего грантов: {total.toLocaleString('ru-RU')}
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between text-xs text-fg-tertiary">
      <div>
        Страница {page} из {totalPages} · всего {total.toLocaleString('ru-RU')}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Назад
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Вперёд
        </Button>
      </div>
    </div>
  );
}
