'use client';

/**
 * HealthDbTab — вкладка «БД» в /admin/health.
 * Источник: `GET /api/v1/admin/health/db` (Фаза 1 ТЗ admin-redesign).
 * Fallback: общий `GET /api/v1/admin/health`.
 */

import { Database } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { apiClient } from '@/api/api-client';
import { adminHealthApi } from '@/api/admin-health.api';
import type { AdminHealthApi } from '@/domain/admin-health';
import { Card, CardContent } from '@/ui/shadcn/card';

import {
  AdminEmpty,
  AdminError,
  AdminLoading,
} from '../AdminStateViews';
import { useAdminQuery } from '../useAdminQuery';

function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'неизвестно';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} КБ`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} МБ`;
  return `${(bytes / 1024 ** 3).toFixed(2)} ГБ`;
}

export function HealthDbTab() {
  const q = useAdminQuery(
    'admin-health-db',
    async () => {
      try {
        return await apiClient.get<{ database: AdminHealthApi['database'] }>(
          '/api/v1/admin/health/db',
        );
      } catch (e) {
        if (
          e instanceof ApiError &&
          (e.code === 'http_404' || e.code === 'not_found')
        ) {
          const merged = await adminHealthApi.get();
          return { database: merged.database };
        }
        throw e;
      }
    },
    [],
  );

  if (q.isLoading) return <AdminLoading rows={4} />;
  if (q.error) return <AdminError message={q.error} onRetry={q.refetch} />;
  if (!q.data) {
    return (
      <AdminEmpty
        title="Раздел будет наполнен в этой же фазе"
        description="Если видишь это после деплоя — обновится при следующем релизе бэкенда."
      />
    );
  }

  const db = q.data.database;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between text-xs uppercase tracking-wide text-fg-tertiary">
          <span>Размер базы данных</span>
          <Database size={14} />
        </div>
        <div className="text-2xl font-semibold">{formatBytes(db.sizeBytes)}</div>
        <div className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <DbRow label="idea_blocks" value={db.ideaBlocksTotal} />
          <DbRow label="entities" value={db.entitiesTotal} />
          <DbRow label="raw_events" value={db.rawEventsTotal} />
          <DbRow label="ai_usage_log" value={db.aiUsageLogTotal} />
        </div>
      </CardContent>
    </Card>
  );
}

function DbRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border-subtle bg-bg-card px-3 py-2">
      <span className="font-mono text-xs text-fg-secondary">{label}</span>
      <span className="font-medium tabular-nums">
        {value.toLocaleString('ru-RU')}
      </span>
    </div>
  );
}
