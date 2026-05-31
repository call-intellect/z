'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import useSWR from 'swr';

import { ApiError } from '@/api/api-error';
import { tablesApi } from '@/api/tables.api';
import { useAuth } from '@/contexts/auth-context';
import {
  propertyFromApi,
  rowFromApi,
  tableFromApi,
  type TablePropType,
} from '@/domain/table';
import { Skeleton } from '@/ui/shadcn/skeleton';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
} from '@app/(admin)/admin/AdminStateViews';

import { EmptyState } from './components/EmptyState';
import { TableHeader } from './components/TableHeader';
import { useTableStore } from './store/tableStore';

/**
 * `GridView` использует `@glideapps/glide-data-grid`, который работает на
 * Canvas → не подходит для SSR. Импортируем динамически с `ssr: false`.
 */
const GridView = dynamic(
  () => import('./components/GridView').then((m) => m.GridView),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[600px] items-center justify-center rounded-md border border-border-subtle bg-bg-card">
        <Loader2 className="h-6 w-6 animate-spin text-fg-secondary" />
      </div>
    ),
  },
);

export function TableClient({ tableId }: { tableId: string }) {
  const { currentOrgId, isLoading } = useAuth();
  if (isLoading) return null;
  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Этот раздел доступен только в рамках Org."
      />
    );
  }
  return <Content orgId={currentOrgId} tableId={tableId} />;
}

function Content({ orgId, tableId }: { orgId: string; tableId: string }) {
  const tableSwr = useSWR(
    ['table', orgId, tableId],
    () => tablesApi.byId(orgId, tableId),
    { revalidateOnFocus: false },
  );
  const propsSwr = useSWR(
    ['table-properties', orgId, tableId],
    () => tablesApi.listProperties(orgId, tableId),
    { revalidateOnFocus: false },
  );
  const rowsSwr = useSWR(
    ['table-rows', orgId, tableId],
    () => tablesApi.listRows(orgId, tableId, { limit: 1000, archived: 'active' }),
    { revalidateOnFocus: false },
  );

  const isLoading = tableSwr.isLoading || propsSwr.isLoading || rowsSwr.isLoading;
  const error = tableSwr.error ?? propsSwr.error ?? rowsSwr.error;

  // Hydrate store при первой успешной загрузке всех трёх SWR'ов.
  const hydrate = useTableStore((s) => s.hydrate);
  const reset = useTableStore((s) => s.reset);
  const hydratedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!tableSwr.data || !propsSwr.data || !rowsSwr.data) return;
    const key = `${orgId}:${tableId}`;
    if (hydratedKey.current === key) return;
    hydrate({
      orgId,
      tableId,
      table: tableFromApi(tableSwr.data),
      properties: propsSwr.data.items.map(propertyFromApi),
      rows: rowsSwr.data.items.map(rowFromApi),
    });
    hydratedKey.current = key;
  }, [orgId, tableId, tableSwr.data, propsSwr.data, rowsSwr.data, hydrate]);

  useEffect(
    () => () => {
      reset();
      hydratedKey.current = null;
    },
    [reset],
  );

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-4 px-6 py-8">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-[600px] w-full" />
      </div>
    );
  }

  if (error) {
    if (error instanceof ApiError && error.code === 'http_404') {
      return (
        <div className="mx-auto w-full max-w-4xl px-6 py-8">
          <AdminEmpty
            title="Таблица не найдена"
            description="Возможно, она была удалена или у вас нет доступа."
          />
        </div>
      );
    }
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        <AdminError
          message={
            error instanceof Error
              ? error.message
              : 'Не удалось загрузить таблицу.'
          }
          onRetry={() => {
            void tableSwr.mutate();
            void propsSwr.mutate();
            void rowsSwr.mutate();
          }}
        />
      </div>
    );
  }

  return <Loaded />;
}

function Loaded() {
  const table = useTableStore((s) => s.table);
  const properties = useTableStore((s) => s.properties);
  const rows = useTableStore((s) => s.rows);
  const isMutating = useTableStore((s) => s.isMutating);
  const mutationError = useTableStore((s) => s.mutationError);
  const updateCell = useTableStore((s) => s.updateCell);
  const addRow = useTableStore((s) => s.addRow);
  const addColumn = useTableStore((s) => s.addColumn);
  const reorderColumn = useTableStore((s) => s.reorderColumn);
  const reorderRow = useTableStore((s) => s.reorderRow);

  // Stable ref для AddColumnButton: пробрасываем addColumn без unwrap.
  const onAddColumn = async (type: TablePropType, name: string) => {
    await addColumn(type, name);
  };

  const onAddRow = async () => {
    await addRow();
  };

  const onCellEdited = (
    rowId: string,
    propertyId: string,
    value: unknown,
  ) => {
    void updateCell(rowId, propertyId, value);
  };

  const onColumnMoved = (from: number, to: number) => {
    const p = properties[from];
    if (!p) return;
    void reorderColumn(p.id, to);
  };

  const onRowMoved = (from: number, to: number) => {
    const r = rows[from];
    if (!r) return;
    void reorderRow(r.id, to);
  };

  // Trigger AddColumnButton из EmptyState — простая прокрутка к кнопке
  // (отдельный popover-controlled state не делаем, чтобы не плодить prop-drilling).
  const headerRef = useRef<HTMLDivElement>(null);
  const onAddColumnClick = () => {
    headerRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  if (!table) return null;

  const isEmpty = properties.length === 0 || rows.length === 0;

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8">
      <Link
        href="/tables"
        className="mb-3 inline-flex items-center gap-1 text-sm text-fg-secondary transition-colors hover:text-fg-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        Все таблицы
      </Link>

      <div ref={headerRef}>
        <TableHeader
          table={table}
          onAddRow={onAddRow}
          onAddColumn={onAddColumn}
          isMutating={isMutating}
        />
      </div>

      {mutationError ? (
        <div className="mb-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {mutationError}
        </div>
      ) : null}

      {isEmpty ? (
        <EmptyState
          onAddRow={onAddRow}
          onAddColumnClick={onAddColumnClick}
          hasProperties={properties.length > 0}
          isMutating={isMutating}
        />
      ) : (
        <div className="rounded-md border border-border-subtle bg-bg-card">
          <GridView
            properties={properties}
            rows={rows}
            onCellEdited={onCellEdited}
            onRowAppended={onAddRow}
            onColumnMoved={onColumnMoved}
            onRowMoved={onRowMoved}
          />
        </div>
      )}
    </div>
  );
}
