'use client';

/**
 * AuditClient — `/admin/audit` (admin-redesign Фаза 1).
 *
 * Журнал действий super_admin (модель `SuperAdminAccessLog`).
 *
 * UI:
 *   - `AdminSection` + фильтры в шапке (select super_admin, input route,
 *     date-range).
 *   - Таблица: когда / кто (email) / route / method / tenantId / reason.
 *   - Cursor-based pagination — кнопка «Показать ещё» внизу.
 *   - CSV-экспорт текущей подборки.
 *
 * Эндпоинты:
 *   - `GET /api/v1/admin/audit?...` (cursor)
 *   - `GET /api/v1/admin/audit/admins` (для select)
 *
 * Если бэкенд ещё не реализован — показываем `AdminEmpty` и заглушку
 * фильтров.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError } from '@/api/api-error';
import { adminAuditApi } from '@/api/admin-audit.api';
import {
  adminAuditAdminsListFromApi,
  adminAuditListFromApi,
  type AdminAuditAdminDomain,
  type AdminAuditEntryDomain,
} from '@/domain/admin-audit';
import { AdminSection } from '@/ui/components/admin/AdminSection';
import { AdminCsvDownloadButton } from '@/ui/components/admin/AdminCsvDownloadButton';
import { DateRangePicker } from '@/ui/components/admin/DateRangePicker';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent } from '@/ui/shadcn/card';
import { Input } from '@/ui/shadcn/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';

import { adminRootCrumb } from '@/ui/components/admin/brand';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
  AdminLoadingInline,
} from '../AdminStateViews';

const ALL_ADMINS_VALUE = '__all__';

type Filters = {
  adminUserId: string;
  route: string;
  from: string;
  to: string;
};

const EMPTY_FILTERS: Filters = {
  adminUserId: ALL_ADMINS_VALUE,
  route: '',
  from: '',
  to: '',
};

export function AuditClient() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  // Список super_admin'ов для select.
  const [admins, setAdmins] = useState<AdminAuditAdminDomain[]>([]);
  const [adminsError, setAdminsError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    adminAuditApi
      .listAdmins()
      .then((res) => {
        if (cancelled) return;
        setAdmins(adminAuditAdminsListFromApi(res).items);
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.code === 'forbidden') {
          setAdminsError('forbidden');
        } else if (
          e instanceof ApiError &&
          (e.code === 'http_404' || e.code === 'not_found')
        ) {
          setAdminsError('not_implemented');
        } else {
          setAdminsError(
            e instanceof ApiError ? e.message : 'Не удалось загрузить список',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Список записей с cursor.
  const [items, setItems] = useState<AdminAuditEntryDomain[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isAppending, setIsAppending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isForbidden, setIsForbidden] = useState(false);
  const [notImplemented, setNotImplemented] = useState(false);

  const loadPage = useCallback(
    async (mode: 'reset' | 'append') => {
      if (mode === 'reset') {
        setIsLoading(true);
        setItems([]);
        setCursor(null);
        setHasMore(true);
      } else {
        setIsAppending(true);
      }
      setError(null);
      setIsForbidden(false);
      setNotImplemented(false);

      try {
        const res = await adminAuditApi.list({
          adminUserId:
            filters.adminUserId !== ALL_ADMINS_VALUE
              ? filters.adminUserId
              : undefined,
          route: filters.route.trim() || undefined,
          from: filters.from || undefined,
          to: filters.to || undefined,
          cursor: mode === 'append' && cursor ? cursor : undefined,
          limit: 50,
        });
        const dom = adminAuditListFromApi(res);
        setItems((prev) =>
          mode === 'append' ? [...prev, ...dom.items] : dom.items,
        );
        setCursor(dom.nextCursor);
        setHasMore(Boolean(dom.nextCursor));
      } catch (e) {
        if (e instanceof ApiError && e.code === 'forbidden') {
          setIsForbidden(true);
        } else if (
          e instanceof ApiError &&
          (e.code === 'http_404' || e.code === 'not_found')
        ) {
          setNotImplemented(true);
        } else {
          setError(e instanceof ApiError ? e.message : 'Ошибка загрузки');
        }
      } finally {
        setIsLoading(false);
        setIsAppending(false);
      }
    },
    [filters, cursor],
  );

  // Загрузка при изменении фильтров.
  useEffect(() => {
    void loadPage('reset');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.adminUserId, filters.route, filters.from, filters.to]);

  const csvRows = useMemo(
    () =>
      items.map((it) => ({
        createdAt: it.createdAt.toISOString(),
        superAdminEmail: it.superAdminEmail ?? '',
        method: it.method,
        route: it.route,
        tenantId: it.accessedTenantId ?? '',
        reason: it.reason ?? '',
      })),
    [items],
  );

  return (
    <AdminSection
      breadcrumbs={[
        adminRootCrumb(),
        { label: 'Пульс', href: '/admin' },
        { label: 'Журнал super_admin' },
      ]}
      title="Журнал super_admin"
      description="Все действия super_admin'ов в админке. Высокая прозрачность: фильтр по человеку, маршруту и периоду."
      actions={
        <AdminCsvDownloadButton
          rows={csvRows}
          columns={[
            { key: 'createdAt', label: 'Когда' },
            { key: 'superAdminEmail', label: 'Кто' },
            { key: 'method', label: 'Метод' },
            { key: 'route', label: 'Маршрут' },
            { key: 'tenantId', label: 'tenantId' },
            { key: 'reason', label: 'Причина' },
          ]}
          filename="admin-audit"
        />
      }
    >
      <div className="space-y-4">
        {/* Фильтры */}
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            <label className="flex min-w-[200px] flex-col gap-1 text-xs text-fg-secondary">
              <span>Super_admin</span>
              <Select
                value={filters.adminUserId}
                onValueChange={(v) =>
                  setFilters((s) => ({ ...s, adminUserId: v }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Все" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_ADMINS_VALUE}>Все</SelectItem>
                  {admins.map((a) => (
                    <SelectItem key={a.userId} value={a.userId}>
                      {a.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {adminsError === 'not_implemented' ? (
                <span className="text-[10px] text-fg-tertiary">
                  Бэкенд не отвечает — список пуст.
                </span>
              ) : null}
            </label>

            <label className="flex min-w-[220px] flex-col gap-1 text-xs text-fg-secondary">
              <span>Маршрут содержит</span>
              <Input
                value={filters.route}
                onChange={(e) =>
                  setFilters((s) => ({ ...s, route: e.target.value }))
                }
                placeholder="например, /admin/orgs"
              />
            </label>

            <DateRangePicker
              from={filters.from}
              to={filters.to}
              onFromChange={(v) => setFilters((s) => ({ ...s, from: v }))}
              onToChange={(v) => setFilters((s) => ({ ...s, to: v }))}
            />

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFilters(EMPTY_FILTERS)}
            >
              Сбросить
            </Button>
          </CardContent>
        </Card>

        {/* Контент */}
        {isLoading ? <AdminLoading rows={8} /> : null}
        {!isLoading && isForbidden ? <AdminForbidden /> : null}
        {!isLoading && notImplemented ? (
          <AdminEmpty
            title="Раздел будет наполнен в этой же фазе"
            description="Бэкенд журнала super_admin'а ещё не подключён. Если видишь это после деплоя — обновится при следующем релизе."
          />
        ) : null}
        {!isLoading && error ? (
          <AdminError message={error} onRetry={() => void loadPage('reset')} />
        ) : null}
        {!isLoading && !isForbidden && !notImplemented && !error ? (
          <Card>
            <CardContent className="p-0">
              {items.length === 0 ? (
                <div className="p-6">
                  <AdminEmpty
                    title="Записей нет"
                    description="За выбранный период действий super_admin не зафиксировано."
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
                      <tr>
                        <th className="px-3 py-2 text-left">Когда</th>
                        <th className="px-3 py-2 text-left">Кто</th>
                        <th className="px-3 py-2 text-left">Метод</th>
                        <th className="px-3 py-2 text-left">Маршрут</th>
                        <th className="px-3 py-2 text-left">tenantId</th>
                        <th className="px-3 py-2 text-left">Причина</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it) => (
                        <tr
                          key={it.id}
                          className="border-t border-border-subtle align-top"
                        >
                          <td className="px-3 py-2 text-xs text-fg-tertiary">
                            {it.createdAt.toLocaleString('ru-RU')}
                          </td>
                          <td className="px-3 py-2">
                            {it.superAdminEmail ?? (
                              <span className="font-mono text-xs text-fg-tertiary">
                                {it.superAdminUserId}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">
                            {it.method}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">
                            {it.route}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-fg-tertiary">
                            {it.accessedTenantId ?? '—'}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {it.reason ?? (
                              <span className="text-fg-tertiary">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}

        {hasMore && items.length > 0 && !isLoading ? (
          <div className="flex items-center justify-center">
            {isAppending ? (
              <AdminLoadingInline label="Загружаем ещё…" />
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadPage('append')}
              >
                Показать ещё
              </Button>
            )}
          </div>
        ) : null}
      </div>
    </AdminSection>
  );
}
